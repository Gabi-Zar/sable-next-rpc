import { beforeEach, expect, test, vi } from 'vitest';
import type { Session } from 'electron';

const { showMessageBox } = vi.hoisted(() => ({
  showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })),
}));
vi.mock('electron', () => ({ dialog: { showMessageBox } }));
vi.mock('node:fs', () => ({ readFileSync: () => '[]' }));
vi.mock('node:fs/promises', () => ({ writeFile: vi.fn(() => Promise.resolve()) }));

import { enforcePermissions } from './permissions';

type RequestHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
type CheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;

function handlers() {
  let request!: RequestHandler;
  let check!: CheckHandler;
  const session = {
    setPermissionRequestHandler: (handler: RequestHandler) => (request = handler),
    setPermissionCheckHandler: (handler: CheckHandler) => (check = handler),
  } as unknown as Session;
  enforcePermissions(
    session,
    '/unused/grants.json',
    (url) => url === 'sable-app://app/',
    () => null
  );
  return { request, check };
}

function contents(url = 'sable-app://app/') {
  return { getURL: () => url } as Parameters<RequestHandler>[0];
}

beforeEach(() => vi.clearAllMocks());

test('allows Electron 44 display capture to reach the source picker', () => {
  const callback = vi.fn();
  handlers().request(contents(), 'media', callback, {
    isMainFrame: true,
    requestingUrl: 'sable-app://app/',
    mediaTypes: [],
  });
  expect(callback).toHaveBeenCalledWith(true);
  expect(showMessageBox).not.toHaveBeenCalled();
});

test('does not allow an empty media request from an external page', () => {
  const callback = vi.fn();
  handlers().request(contents('https://example.org/'), 'media', callback, {
    isMainFrame: true,
    requestingUrl: 'https://example.org/',
    mediaTypes: [],
  });
  expect(callback).toHaveBeenCalledWith(false);
});

test('a media request with missing details is still denied', () => {
  const callback = vi.fn();
  handlers().request(contents(), 'media', callback, {
    isMainFrame: true,
    requestingUrl: 'sable-app://app/',
  });
  expect(callback).toHaveBeenCalledWith(false);
});

test.each(['audio', 'video'] as const)(
  'keeps %s device permissions on their existing path',
  async (type) => {
    const callback = vi.fn();
    handlers().request(contents(), 'media', callback, {
      isMainFrame: true,
      requestingUrl: 'sable-app://app/',
      mediaTypes: [type],
    });
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(process.platform === 'darwin');
    });
    expect(showMessageBox).toHaveBeenCalledTimes(process.platform === 'darwin' ? 0 : 1);
  }
);

test('allows the explicit display-capture permission used by newer Electron versions', () => {
  const callback = vi.fn();
  handlers().request(contents(), 'display-capture', callback, {
    isMainFrame: true,
    requestingUrl: 'sable-app://app/',
  });
  expect(callback).toHaveBeenCalledWith(true);
});
