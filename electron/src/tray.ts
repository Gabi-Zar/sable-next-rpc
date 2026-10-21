import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';

export function hideToTray(window: BrowserWindow): void {
  window.webContents.send('sable-window-hidden-to-tray');
  window.hide();
}

export class DesktopTray {
  private tray: Tray | null = null;

  constructor(
    private readonly iconPath: string,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  get available(): boolean {
    return this.tray !== null;
  }

  showWindow(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  update(show: boolean): boolean {
    if (!show || (this.platform !== 'win32' && this.platform !== 'linux')) {
      const wasAvailable = this.available;
      this.destroy();
      const window = this.getWindow();
      if (wasAvailable && window && !window.isDestroyed() && !window.isVisible()) {
        this.showWindow();
      }
      return false;
    }
    if (this.tray) return true;

    try {
      const icon = nativeImage.createFromPath(this.iconPath);
      if (icon.isEmpty()) throw new Error(`Could not load tray icon: ${this.iconPath}`);
      this.tray = new Tray(icon);
      this.tray.setToolTip('Sable');
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: 'Show Sable',
            click: () => {
              this.showWindow();
            },
          },
          { type: 'separator' },
          {
            label: 'Quit Sable',
            click: () => {
              app.quit();
            },
          },
        ])
      );
      if (this.platform === 'win32') {
        this.tray.on('double-click', () => {
          const window = this.getWindow();
          if (!window || window.isDestroyed()) return;
          if (window.isVisible() && !window.isMinimized()) hideToTray(window);
          else this.showWindow();
        });
      } else {
        this.tray.on('click', () => {
          this.showWindow();
        });
      }
      return true;
    } catch (error) {
      this.destroy();
      console.error('[sable tray] could not create the tray icon', error);
      return false;
    }
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
