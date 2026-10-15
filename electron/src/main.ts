import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  net,
  protocol,
  session,
  shell,
  utilityProcess,
  webContents,
  type DesktopCapturerSource,
  type UtilityProcess,
} from 'electron';
import { statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { claimSchemes } from './linux-schemes';
import * as screenAudio from './screen-audio';
import { readSettings, sanitize } from './settings';

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

function isAppUrl(url: string | undefined): boolean {
  return !!url && originOf(url) === (devUrl ? originOf(devUrl) : APP_ORIGIN);
}

function openExternal(url: string): void {
  const { protocol: scheme } = new URL(url);
  if (['http:', 'https:', 'mailto:', 'tel:'].includes(scheme)) void shell.openExternal(url);
}

function serveApp(request: Request): Promise<Response> {
  const path = resolve(distDir, `.${decodeURIComponent(new URL(request.url).pathname)}`);
  const inside = !relative(distDir, path).startsWith('..');
  const stat = inside ? statSync(path, { throwIfNoEntry: false }) : undefined;
  const file = stat?.isDirectory() ? join(path, 'index.html') : path;
  const found = stat !== undefined && statSync(file, { throwIfNoEntry: false })?.isFile();
  return net.fetch(pathToFileURL(found ? file : join(distDir, '404.html')).toString());
}

let mainWindow: BrowserWindow | null = null;
let core: UtilityProcess | null = null;
let quitting = false;
let pageListening = false;

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
  isAppUrl(event.senderFrame?.url) ? pendingDeepLinks.splice(0) : []
);

ipcMain.on('sable-deep-links-listening', (event) => {
  if (isAppUrl(event.senderFrame?.url)) pageListening = true;
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
  if (!isAppUrl(event.senderFrame?.url)) return;
  const next = sanitize(value);
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  settings = next;
  writeFileSync(settingsPath, JSON.stringify(next));
  for (const contents of webContents.getAllWebContents()) {
    contents.setWebRTCIPHandlingPolicy(next.webRtcIpPolicy);
  }
});

ipcMain.on('sable-core-connect', (event) => {
  if (event.ports.length !== 1 || !isAppUrl(event.senderFrame?.url)) return;
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
  if (!isAppUrl(event.senderFrame?.url) || typeof request !== 'number') return;
  pendingPicks.get(request)?.(typeof id === 'string' ? id : null);
  pendingPicks.delete(request);
});

ipcMain.handle('sable-screen-audio-apps', (event) =>
  isAppUrl(event.senderFrame?.url) ? screenAudio.listApps() : []
);

ipcMain.handle('sable-screen-audio-start', (event, selection: unknown) => {
  if (!isAppUrl(event.senderFrame?.url)) throw new Error('not the app');
  return screenAudio.start(selection);
});

ipcMain.handle('sable-screen-audio-stop', (event) => {
  if (isAppUrl(event.senderFrame?.url)) screenAudio.stop();
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
  const thumbnailSize = isWayland ? { width: 0, height: 0 } : { width: 320, height: 180 };
  const sources = await desktopCapturer
    .getSources({ types: ['screen', 'window'], thumbnailSize })
    .catch(() => []);
  const id = isWayland ? sources[0]?.id : await pickScreenSource(sources);
  return sources.find((candidate) => candidate.id === id);
}

function registerScreenShare(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    void chooseShareSource().then((source) => {
      callback(source ? { video: source } : {});
    });
  });
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

  if (isLinux) {
    claimSchemes(join(xdgDataHome(), 'applications'), IDENTIFIER, DEEP_LINK_SCHEMES);
  } else if (app.isPackaged) {
    for (const scheme of DEEP_LINK_SCHEMES) {
      const handler = app.getApplicationNameForProtocol(`${scheme}://`);
      if (handler === '' || app.isDefaultProtocolClient(scheme)) {
        app.setAsDefaultProtocolClient(scheme);
      }
    }
  }

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  void app.whenReady().then(() => {
    core = startCore();
    protocol.handle(SCHEME, serveApp);
    registerScreenShare();
    mainWindow = createWindow();
  });
}
