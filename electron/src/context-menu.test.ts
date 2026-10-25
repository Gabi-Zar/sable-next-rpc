import { EventEmitter } from 'node:events';
import type { BrowserWindow, ContextMenuParams } from 'electron';
import { beforeEach, expect, test, vi } from 'vitest';

const { buildFromTemplate, popup } = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(),
  popup: vi.fn(),
}));

vi.mock('electron', () => ({ Menu: { buildFromTemplate } }));

import { registerContextMenu } from './context-menu';

beforeEach(() => {
  vi.clearAllMocks();
  buildFromTemplate.mockReturnValue({ popup });
});

function setup() {
  const webContents = new EventEmitter();
  const window = { webContents } as unknown as BrowserWindow;
  registerContextMenu(window);
  return { webContents, window };
}

const editFlags: ContextMenuParams['editFlags'] = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: true,
  canDelete: false,
  canSelectAll: false,
  canEditRichly: true,
};

test('opens a native edit menu for an empty composer with paste available', () => {
  const { webContents, window } = setup();
  webContents.emit('context-menu', {}, { isEditable: true, editFlags });
  expect(buildFromTemplate).toHaveBeenCalledWith([
    { role: 'undo', enabled: false },
    { role: 'redo', enabled: false },
    { type: 'separator' },
    { role: 'cut', enabled: false },
    { role: 'copy', enabled: false },
    { role: 'paste', enabled: true },
    { type: 'separator' },
    { role: 'selectAll', enabled: false },
  ]);
  expect(popup).toHaveBeenCalledWith({ window });
});

test('updates available actions when text is selected and the clipboard is empty', () => {
  const { webContents } = setup();
  webContents.emit('context-menu', {}, { isEditable: true, editFlags });
  webContents.emit(
    'context-menu',
    {},
    {
      isEditable: true,
      editFlags: {
        ...editFlags,
        canUndo: true,
        canRedo: true,
        canCut: true,
        canCopy: true,
        canPaste: false,
        canSelectAll: true,
      },
    }
  );
  expect(buildFromTemplate).toHaveBeenLastCalledWith([
    { role: 'undo', enabled: true },
    { role: 'redo', enabled: true },
    { type: 'separator' },
    { role: 'cut', enabled: true },
    { role: 'copy', enabled: true },
    { role: 'paste', enabled: false },
    { type: 'separator' },
    { role: 'selectAll', enabled: true },
  ]);
});

test('leaves non-editable areas to the app context menus', () => {
  const { webContents } = setup();
  webContents.emit('context-menu', {}, { isEditable: false, editFlags });
  expect(buildFromTemplate).not.toHaveBeenCalled();
  expect(popup).not.toHaveBeenCalled();
});
