import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export function registerContextMenu(window: BrowserWindow): void {
  window.webContents.on(
    'context-menu',
    (_event, { isEditable, editFlags, dictionarySuggestions }) => {
      if (!isEditable) return;
      const suggestions: MenuItemConstructorOptions[] = dictionarySuggestions.map((suggestion) => ({
        label: suggestion,
        click: () => {
          window.webContents.replaceMisspelling(suggestion);
        },
      }));
      if (suggestions.length > 0) suggestions.push({ type: 'separator' });
      Menu.buildFromTemplate([
        ...suggestions,
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll },
      ]).popup({ window });
    }
  );
}
