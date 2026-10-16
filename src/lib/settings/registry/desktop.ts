import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
import FilmStripIcon from 'phosphor-svelte/lib/FilmStripIcon';
import GraphicsCardIcon from 'phosphor-svelte/lib/GraphicsCardIcon';
import MouseIcon from 'phosphor-svelte/lib/MouseIcon';
import { isElectron } from '#lib/platform/electron.js';
import {
  supportsDesktopWindow,
  supportsSmoothScrollingToggle,
  supportsTray,
} from '#lib/platform/window-decorations.js';
import type { SettingsCategory } from '../registry';

export const desktopCategories: SettingsCategory[] =
  supportsDesktopWindow() || isElectron()
    ? [
        {
          id: 'desktop',
          name: 'settings.desktopTitle',
          icon: DesktopIcon,
          sections: [
            { id: 'window', name: 'settings.groups.window' },
            { id: 'performance', name: 'settings.groups.performance' },
          ],
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
              supported: supportsTray,
            },
            {
              key: 'closeToTray',
              section: 'window',
              icon: DesktopIcon,
              name: 'settings.closeToTray',
              description: 'settings.closeToTrayHint',
              type: 'boolean',
              gatedBy: 'showSystemTrayIcon',
              supported: supportsTray,
            },
            {
              key: 'minimizeToTray',
              section: 'window',
              icon: DesktopIcon,
              name: 'settings.minimizeToTray',
              description: 'settings.minimizeToTrayHint',
              type: 'boolean',
              gatedBy: 'showSystemTrayIcon',
              supported: supportsTray,
            },
            {
              key: 'hardwareAcceleration',
              section: 'performance',
              icon: GraphicsCardIcon,
              name: 'settings.hardwareAcceleration',
              description: 'settings.hardwareAccelerationHint',
              type: 'boolean',
              supported: isElectron,
            },
            {
              key: 'hardwareVideoAcceleration',
              section: 'performance',
              icon: FilmStripIcon,
              name: 'settings.hardwareVideoAcceleration',
              description: 'settings.hardwareVideoAccelerationHint',
              type: 'boolean',
              gatedBy: 'hardwareAcceleration',
              supported: isElectron,
            },
            {
              key: 'smoothScrolling',
              section: 'performance',
              icon: MouseIcon,
              name: 'settings.smoothScrolling',
              description: 'settings.smoothScrollingHint',
              type: 'boolean',
              supported: supportsSmoothScrollingToggle,
            },
          ],
        },
      ]
    : [];
