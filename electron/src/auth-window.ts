import { BrowserWindow } from 'electron';

export function matchesAuthCallback(url: string, callbackUri: string): boolean {
  const candidate = URL.parse(url);
  const expected = URL.parse(callbackUri);
  return !!(
    candidate &&
    expected &&
    candidate.protocol === expected.protocol &&
    candidate.host === expected.host &&
    candidate.pathname === expected.pathname &&
    [...expected.searchParams].every(([key, value]) => candidate.searchParams.get(key) === value)
  );
}

export class AuthWindows {
  private readonly windows = new Map<string, BrowserWindow>();

  constructor(private readonly onCallback: (url: string) => void) {}

  async open(parent: BrowserWindow, id: string, url: string, callbackUri?: string): Promise<void> {
    const parsed = URL.parse(url);
    if (!parsed || !['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Authentication requires an HTTP or HTTPS URL');
    }
    this.close(id);
    const popup = new BrowserWindow({
      parent,
      width: 520,
      height: 720,
      title: 'Sable',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    this.windows.set(id, popup);
    const closeWithParent = () => {
      if (!popup.isDestroyed()) popup.destroy();
    };
    popup.once('closed', () => {
      if (this.windows.get(id) === popup) this.windows.delete(id);
      parent.removeListener('closed', closeWithParent);
    });
    parent.once('closed', closeWithParent);
    const navigate = (event: { preventDefault(): void }, target: string) => {
      if (callbackUri && matchesAuthCallback(target, callbackUri)) {
        event.preventDefault();
        this.onCallback(target);
        this.close(id);
        return;
      }
      const destination = URL.parse(target);
      if (!destination || !['https:', 'http:'].includes(destination.protocol)) {
        event.preventDefault();
      }
    };
    popup.webContents.on('will-navigate', navigate);
    popup.webContents.on('will-redirect', navigate);
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await popup.loadURL(url);
    } catch (error) {
      // Intercepting the callback aborts the pending navigation.
      if (!popup.isDestroyed()) {
        this.close(id);
        throw error;
      }
    }
  }

  close(id: string): void {
    const popup = this.windows.get(id);
    this.windows.delete(id);
    if (popup && !popup.isDestroyed()) popup.destroy();
  }
}
