import { Menu, type BrowserWindow } from 'electron';

export function registerContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, { isEditable, editFlags }) => {
    if (!isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo', enabled: editFlags.canUndo },
      { role: 'redo', enabled: editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: editFlags.canCut },
      { role: 'copy', enabled: editFlags.canCopy },
      { role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    ]).popup({ window });
  });
}
