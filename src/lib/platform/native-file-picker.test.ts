// @vitest-environment happy-dom

import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  electronBridge: vi.fn(),
  isNativeMobile: vi.fn(),
  pickFiles: vi.fn(),
}));

vi.mock('./electron.js', () => ({ electronBridge: mocks.electronBridge }));
vi.mock('./os.js', () => ({ isNativeMobile: mocks.isNativeMobile }));
vi.mock('./files.js', () => ({ pickFiles: mocks.pickFiles }));

import { nativeFilePicker } from './native-file-picker.js';

function mount(accept = 'image/*', multiple = false) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  document.body.append(input);

  const action = nativeFilePicker(input);
  const changes = vi.fn();
  input.addEventListener('change', changes);
  return { action, changes, input };
}

function click(input: HTMLInputElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  mocks.electronBridge.mockReturnValue(undefined);
  mocks.isNativeMobile.mockReturnValue(false);
});

test('desktop webviews keep their own file picker', () => {
  const { input } = mount();

  const event = click(input);

  expect(event.defaultPrevented).toBe(false);
  expect(mocks.pickFiles).not.toHaveBeenCalled();
});

test('native mobile opens the native picker and replays the change event', async () => {
  mocks.isNativeMobile.mockReturnValue(true);
  const file = new File(['png'], 'avatar.png', { type: 'image/png' });
  mocks.pickFiles.mockResolvedValue([file]);
  const { changes, input } = mount();

  const event = click(input);

  expect(event.defaultPrevented).toBe(true);
  expect(mocks.pickFiles).toHaveBeenCalledWith('image/*');
  await vi.waitFor(() => {
    expect(changes).toHaveBeenCalledOnce();
  });
  expect([...(input.files ?? [])]).toEqual([file]);
});

test('Electron opens the native picker too, and single inputs keep one file', async () => {
  mocks.electronBridge.mockReturnValue({});
  const first = new File(['a'], 'a.png', { type: 'image/png' });
  const second = new File(['b'], 'b.png', { type: 'image/png' });
  mocks.pickFiles.mockResolvedValue([first, second]);
  const { input } = mount('image/*', false);

  click(input);

  await vi.waitFor(() => {
    expect(input.files?.length).toBe(1);
  });
  expect(input.files?.[0]).toBe(first);
});

test('a cancelled native picker leaves the input untouched', async () => {
  mocks.isNativeMobile.mockReturnValue(true);
  mocks.pickFiles.mockResolvedValue([]);
  const { changes, input } = mount();

  click(input);

  await vi.waitFor(() => {
    expect(mocks.pickFiles).toHaveBeenCalledOnce();
  });
  expect(changes).not.toHaveBeenCalled();
  expect(input.files?.length ?? 0).toBe(0);
});

test('a second click while the native picker is open does not open it twice', () => {
  mocks.isNativeMobile.mockReturnValue(true);
  mocks.pickFiles.mockReturnValue(new Promise(() => {}));
  const { input } = mount();

  click(input);
  click(input);

  expect(mocks.pickFiles).toHaveBeenCalledOnce();
});

test('destroying the action restores the webview picker', () => {
  mocks.isNativeMobile.mockReturnValue(true);
  const { action, input } = mount();
  action.destroy();

  const event = click(input);

  expect(event.defaultPrevented).toBe(false);
  expect(mocks.pickFiles).not.toHaveBeenCalled();
});
