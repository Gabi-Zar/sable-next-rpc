import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  systemPreferences,
  Tray,
  nativeImage,
  utilityProcess,
  webContents,
  type DesktopCapturerSource,
  type UtilityProcess,
  type WebFrameMain,
} from 'electron';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { claimSchemes } from './linux-schemes';
import { enforcePermissions } from './permissions';
import * as screenAudio from './screen-audio';
import { readSettings, sanitize } from './settings';

declare const __SABLE_CSP__: Record<string, string>;

const IDENTIFIER = process.env.SABLE_IDENTIFIER ?? 'moe.sable.next';
const SCHEME = 'sable-app';
const DEEP_LINK_SCHEMES =
  IDENTIFIER === 'moe.sable.client' ? ['moe.sable.app', 'sable'] : ['moe.sable.next'];
const APP_ORIGIN = `${SCHEME}://app`;
const PANIC_MARKER = 'SABLE_CORE_PANIC ';

const devUrl = process.env.SABLE_DEV_URL;
const distDir = resolve(app.getAppPath(), process.env.SABLE_DIST ?? '../dist');
const isLinux = process.platform === 'linux';
const isWayland =
  isLinux && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

function xdgDataHome(): string {
  const xdg = process.env.XDG_DATA_HOME;
  return xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'share');
}

const dataDir = join(isLinux ? xdgDataHome() : app.getPath('appData'), IDENTIFIER);
app.setPath('userData', join(app.getPath('appData'), `${IDENTIFIER}.electron`));
const settingsPath = join(app.getPath('userData'), 'settings.json');
let settings = readSettings(settingsPath);

function setFeatures(enable: string[], disable: string[]): void {
  const read = (name: string) =>
    new Set(app.commandLine.getSwitchValue(name).split(',').filter(Boolean));
  const enabled = read('enable-features');
  const disabled = read('disable-features');
  for (const feature of enable) enabled.add(feature);
  for (const feature of disable) disabled.add(feature);
  for (const feature of disabled) enabled.delete(feature);

  for (const [name, features] of [
    ['enable-features', enabled],
    ['disable-features', disabled],
  ] as const) {
    app.commandLine.removeSwitch(name);
    if (features.size > 0) app.commandLine.appendSwitch(name, [...features].join(','));
  }
}

if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();
setFeatures(
  isLinux && settings.hardwareAcceleration && settings.hardwareVideoAcceleration
    ? [
        'AcceleratedVideoDecodeLinuxGL',
        'AcceleratedVideoDecodeLinuxZeroCopyGL',
        'AcceleratedVideoEncoder',
      ]
    : [],
  isLinux ? ['WaylandWpColorManagerV1'] : []
);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
if (process.platform === 'win32') app.setAppUserModelId('moe.sable.next.electron');

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
      allowServiceWorkers: true,
    },
  },
]);

function originOf(url: string): string {
  const { protocol: scheme, host } = new URL(url);
  return `${scheme}//${host}`;
}

const appOrigin = devUrl ? originOf(devUrl) : APP_ORIGIN;

function isAppUrl(url: string | undefined): boolean {
  return !!url && originOf(url) === appOrigin;
}

function isAppFrame(frame: WebFrameMain | null | undefined): boolean {
  return frame?.origin === appOrigin;
}

function openExternal(url: string): void {
  const { protocol: scheme } = new URL(url);
  if (['http:', 'https:', 'mailto:', 'tel:'].includes(scheme)) void shell.openExternal(url);
}

function policy(inlineScripts: string[] = []): string {
  const directives = { ...__SABLE_CSP__ };
  const hashes = inlineScripts.map(
    (script) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`
  );
  directives['script-src'] = [directives['script-src'], ...hashes].join(' ');
  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources}`)
    .join('; ');
}

const pagePolicies = new Map<string, string>();

async function pagePolicy(file: string): Promise<string> {
  const cached = pagePolicies.get(file);
  if (cached) return cached;
  const html = await readFile(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  const computed = policy(scripts.map(([, body]) => body));
  pagePolicies.set(file, computed);
  return computed;
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveApp(request: Request): Promise<Response> {
  const path = resolve(distDir, `.${decodeURIComponent(new URL(request.url).pathname)}`);
  const fromDist = relative(distDir, path);
  const inside = !fromDist.startsWith('..') && !isAbsolute(fromDist);
  const entry = inside ? await stat(path).catch(() => undefined) : undefined;
  const file = entry?.isDirectory() ? join(path, 'index.html') : path;
  const found = entry !== undefined && (await stat(file).catch(() => undefined))?.isFile();
  const target = found ? file : join(distDir, '404.html');

  const headers = new Headers({
    'Content-Type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
    'Content-Security-Policy': target.endsWith('.html') ? await pagePolicy(target) : policy(),
  });
  // Not `net.fetch`: one network loader per module exhausts Chromium's pool on first load.
  return new Response(Readable.toWeb(createReadStream(target)) as ReadableStream, { headers });
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let core: UtilityProcess | null = null;
let quitting = false;
let pageListening = false;

interface DesktopWindowSettings {
  closeToTray: boolean;
  minimizeToTray: boolean;
  showSystemTrayIcon: boolean;
}

let desktopWindowSettings: DesktopWindowSettings = {
  closeToTray: false,
  minimizeToTray: false,
  showSystemTrayIcon: true,
};

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sable-tray.png')
    : join(app.getAppPath(), '../src-tauri/icons/icon.png');
}

function updateTray(show: boolean): boolean {
  if (!isLinux) return false;
  if (!show) {
    tray?.destroy();
    tray = null;
    return false;
  }
  if (tray) return true;

  const icon = nativeImage.createFromPath(trayIconPath());
  if (icon.isEmpty()) {
    console.error('[sable tray] could not load the tray icon', trayIconPath());
    return false;
  }
  tray = new Tray(icon);
  tray.setToolTip('Sable');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Sable', click: showMainWindow },
      { type: 'separator' },
      { role: 'quit' },
    ])
  );
  tray.on('click', showMainWindow);
  return true;
}

function sanitizeDesktopWindowSettings(value: unknown): DesktopWindowSettings {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    closeToTray: stored.closeToTray === true,
    minimizeToTray: stored.minimizeToTray === true,
    showSystemTrayIcon: stored.showSystemTrayIcon !== false,
  };
}

function deepLinksIn(argv: string[]): string[] {
  return argv.filter((arg) => DEEP_LINK_SCHEMES.some((scheme) => arg.startsWith(`${scheme}:`)));
}

const pendingDeepLinks = deepLinksIn(process.argv);

function deliverDeepLinks(urls: string[]): void {
  if (urls.length === 0) return;
  if (mainWindow && pageListening) mainWindow.webContents.send('sable-deep-links', urls);
  else pendingDeepLinks.push(...urls);
}

ipcMain.handle('sable-take-deep-links', (event) =>
  isAppFrame(event.senderFrame) ? pendingDeepLinks.splice(0) : []
);

ipcMain.on('sable-deep-links-listening', (event) => {
  if (isAppFrame(event.senderFrame)) pageListening = true;
});

function startCore(): UtilityProcess {
  const child = utilityProcess.fork(join(__dirname, 'core-host.cjs'), [], {
    serviceName: 'Sable Core',
    stdio: ['ignore', 'inherit', 'pipe'],
    env: { ...process.env, SABLE_DATA_DIR: dataDir },
  });

  let panic: string | undefined;
  let partial = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
    const lines = (partial + chunk.toString()).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith(PANIC_MARKER)) panic ??= line.slice(PANIC_MARKER.length);
    }
  });

  child.once('exit', (code) => {
    if (core === child) core = null;
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('sable-core-exit', panic ?? `core exited with code ${code}`);
  });

  return child;
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWebRTCIPHandlingPolicy(settings.webRtcIpPolicy);
});

ipcMain.on('sable-apply-settings', (event, value: unknown) => {
  if (!isAppFrame(event.senderFrame)) return;
  const next = sanitize(value);
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  settings = next;
  void writeFile(settingsPath, JSON.stringify(next));
  for (const contents of webContents.getAllWebContents()) {
    contents.setWebRTCIPHandlingPolicy(next.webRtcIpPolicy);
  }
});

ipcMain.handle('sable-apply-window-settings', (event, value: unknown) => {
  if (!isAppFrame(event.senderFrame)) return null;
  desktopWindowSettings = sanitizeDesktopWindowSettings(value);
  return { trayAvailable: updateTray(desktopWindowSettings.showSystemTrayIcon) };
});

ipcMain.on('sable-core-connect', (event) => {
  if (event.ports.length !== 1 || !isAppFrame(event.senderFrame)) return;
  core ??= startCore();
  core.postMessage('connect', event.ports);
});

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });
  window.on('close', (event) => {
    if (!quitting && desktopWindowSettings.closeToTray && tray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('minimize', () => {
    if (!quitting && desktopWindowSettings.minimizeToTray && tray) {
      window.hide();
    }
  });
  window.webContents.on('did-navigate', () => {
    pageListening = false;
    cancelPicks();
    screenAudio.stop();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  void window.loadURL(devUrl ?? `${APP_ORIGIN}/`);
  return window;
}

let nextPickRequest = 1;
const pendingPicks = new Map<number, (id: string | null) => void>();

ipcMain.on('sable-screen-picked', (event, request: unknown, id: unknown) => {
  if (!isAppFrame(event.senderFrame) || typeof request !== 'number') return;
  pendingPicks.get(request)?.(typeof id === 'string' ? id : null);
  pendingPicks.delete(request);
});

ipcMain.handle('sable-screen-audio-apps', (event) =>
  isAppFrame(event.senderFrame) ? screenAudio.listApps() : []
);

ipcMain.handle('sable-screen-audio-start', (event, selection: unknown) => {
  if (!isAppFrame(event.senderFrame)) throw new Error('not the app');
  return screenAudio.start(selection);
});

ipcMain.handle('sable-screen-audio-stop', (event) => {
  if (isAppFrame(event.senderFrame)) screenAudio.stop();
});

function cancelPicks(): void {
  for (const resolve of pendingPicks.values()) resolve(null);
  pendingPicks.clear();
}

function pickScreenSource(sources: DesktopCapturerSource[]): Promise<string | null> {
  if (!mainWindow || sources.length === 0) return Promise.resolve(null);
  const request = nextPickRequest++;
  const candidates = sources.map(({ id, name, thumbnail }) => ({
    id,
    name,
    thumbnail: thumbnail.toDataURL(),
  }));
  mainWindow.webContents.send('sable-pick-screen', request, candidates);
  return new Promise((resolve) => {
    pendingPicks.set(request, resolve);
  });
}

async function chooseShareSource(): Promise<DesktopCapturerSource | undefined> {
  // Enumeration requests macOS consent; a status check alone does not.
  const thumbnailSize = isWayland ? { width: 1920, height: 1080 } : { width: 320, height: 180 };
  const sources = await desktopCapturer
    .getSources({ types: ['screen', 'window'], thumbnailSize })
    .catch((error: unknown) => {
      console.error('[sable screen share] could not list sources', error);
      return [];
    });
  if (process.platform === 'darwin') {
    const access = systemPreferences.getMediaAccessStatus('screen');
    if (access === 'denied' || access === 'restricted') {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        message: 'Screen recording access is required to share your screen.',
        detail:
          'Allow Sable in System Settings → Privacy & Security → Screen Recording, then restart Sable.',
        buttons: ['Open System Settings', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        await shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
        );
      }
      return undefined;
    }
  }
  const id = isWayland ? sources[0]?.id : await pickScreenSource(sources);
  return sources.find((candidate) => candidate.id === id);
}

function registerScreenShare(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!isAppFrame(request.frame)) {
      callback(null);
      return;
    }
    void chooseShareSource().then(
      (source) => {
        callback(source ? { video: source } : null);
      },
      (error: unknown) => {
        console.error('[sable screen share] could not select a source', error);
        callback(null);
      }
    );
  });
}

function registerDeepLinks(): void {
  if (isLinux) {
    void claimSchemes(join(xdgDataHome(), 'applications'), IDENTIFIER, DEEP_LINK_SCHEMES);
  } else if (app.isPackaged) {
    for (const scheme of DEEP_LINK_SCHEMES) {
      app.setAsDefaultProtocolClient(scheme);
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    deliverDeepLinks(deepLinksIn(argv));
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverDeepLinks([url]);
  });

  app.on('before-quit', () => {
    quitting = true;
    tray?.destroy();
    tray = null;
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  void app.whenReady().then(() => {
    registerDeepLinks();
    updateTray(desktopWindowSettings.showSystemTrayIcon);
    core = startCore();
    protocol.handle(SCHEME, serveApp);
    enforcePermissions(
      session.defaultSession,
      join(app.getPath('userData'), 'permissions.json'),
      isAppUrl,
      () => mainWindow
    );
    registerScreenShare();
    mainWindow = createWindow();
  });
}
