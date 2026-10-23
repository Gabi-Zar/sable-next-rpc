import { afterEach, assert, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  current: vi.fn<(accepts?: (url: string) => boolean) => Promise<string[]>>(),
  subscribe: vi.fn<(receive: (urls: string[]) => void) => Promise<() => void>>(),
  delivers: vi.fn(() => true),
}));
vi.mock('#lib/platform/deep-links.js', () => ({
  currentDeepLinks: mocks.current,
  subscribeDeepLinks: mocks.subscribe,
  deliversDeepLinks: mocks.delivers,
}));

import { watchMatrixLinks } from './native-links';

beforeEach(() => {
  mocks.delivers.mockReturnValue(true);
  mocks.current.mockResolvedValue([]);
});
afterEach(() => vi.resetAllMocks());

test('opens launch and running-app links while leaving auth callbacks alone', async () => {
  let receive: (urls: string[]) => void = () => {};
  const unsubscribe = vi.fn();
  mocks.subscribe.mockImplementation((callback) => {
    receive = callback;
    return Promise.resolve(unsubscribe);
  });
  mocks.current.mockResolvedValue(['https://matrix.to/#/!room:example.org?via=example.org']);
  const open = vi.fn();
  const stop = watchMatrixLinks(open);
  await vi.waitFor(() => {
    expect(open).toHaveBeenCalledWith('/to/!room%3Aexample.org?via=example.org');
  });
  const accepts = mocks.current.mock.calls[0]?.[0];
  assert(accepts);
  expect(accepts('moe.sable.next:/login?code=a')).toBe(false);
  expect(accepts('matrix:u/alice:example.org')).toBe(true);
  receive(['moe.sable.next:/login?code=a', 'matrix:u/alice:example.org']);
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenLastCalledWith('/to/%40alice%3Aexample.org');
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
  receive(['matrix:u/bob:example.org']);
  expect(open).toHaveBeenCalledTimes(2);
});

test('unsubscribes when disposed while listener registration is pending', async () => {
  const unsubscribe = vi.fn();
  mocks.subscribe.mockResolvedValue(unsubscribe);
  const stop = watchMatrixLinks(vi.fn());
  stop();
  await vi.waitFor(() => {
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  expect(mocks.current).not.toHaveBeenCalled();
});

test('does not subscribe in a browser', () => {
  mocks.delivers.mockReturnValue(false);
  watchMatrixLinks(vi.fn())();
  expect(mocks.subscribe).not.toHaveBeenCalled();
});

test('native Matrix actions retain routing and ignore the reserved fragment', async () => {
  mocks.subscribe.mockResolvedValue(() => {});
  mocks.current.mockResolvedValue([
    'MATRIX://reserved.example/roomid/opaque?via=a.example&action=join#reserved?via=wrong.example',
  ]);
  const open = vi.fn();
  const stop = watchMatrixLinks(open);
  await vi.waitFor(() => {
    expect(open).toHaveBeenCalledWith('/to/!opaque?via=a.example&action=join');
  });
  stop();
});
