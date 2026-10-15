import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
import { supportsDesktopWindow, supportsTray } from '#lib/platform/window-decorations.js';
import type { SettingsCategory } from '../registry';

export const desktopCategories: SettingsCategory[] = supportsDesktopWindow()
  ? [
      {
        id: 'desktop',
        name: 'settings.desktopTitle',
        icon: DesktopIcon,
        sections: [{ id: 'window', name: 'settings.groups.window' }],
        items: [
          {
            key: 'useCustomTitleBar',
            section: 'window',
            icon: DesktopIcon,
            name: 'settings.useCustomTitleBar',
            type: 'boolean',
            supported: supportsDesktopWindow,
          },
          {
            key: 'showSystemTrayIcon',
            section: 'window',
            icon: DesktopIcon,
            name: 'settings.showSystemTrayIcon',
            type: 'boolean',
            supported: () => supportsDesktopWindow() && supportsTray(),
          },
          {
            key: 'closeToTray',
            section: 'window',
            icon: DesktopIcon,
            name: 'settings.closeToTray',
            description: 'settings.closeToTrayHint',
            type: 'boolean',
            gatedBy: 'showSystemTrayIcon',
            supported: () => supportsDesktopWindow() && supportsTray(),
          },
          {
            key: 'minimizeToTray',
            section: 'window',
            icon: DesktopIcon,
            name: 'settings.minimizeToTray',
            description: 'settings.minimizeToTrayHint',
            type: 'boolean',
            gatedBy: 'showSystemTrayIcon',
            supported: () => supportsDesktopWindow() && supportsTray(),
          },
        ],
      },
    ]
  : [];
