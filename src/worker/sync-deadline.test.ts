import { afterEach, expect, test, vi } from 'vitest';

import { withSyncDeadline } from './sync-deadline';

const HOST = 'https://hs.example';
const SYNC = `${HOST}/_matrix/client/unstable/org.matrix.simplified_msc3575/sync`;

function capturing() {
  const seen: Request[] = [];
  const base = vi.fn((input: RequestInfo | URL) => {
    if (input instanceof Request) seen.push(input);
    return Promise.resolve(new Response('{}'));
  });
  return {
    base: base as unknown as typeof fetch,
    seen,
    calls: base.mock.calls,
  };
}

function sync(url = SYNC, signal?: AbortSignal) {
  return new Request(`${url}?timeout=30000`, {
    method: 'POST',
    body: '{}',
    signal,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

test.each([SYNC, `${HOST}/_matrix/client/v5/sync`])(
  'aborts a sync that outlives the native deadline: %s',
  async (url) => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const { base, seen } = capturing();

    await withSyncDeadline(base)(sync(url));

    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(seen[0]?.signal.aborted).toBe(false);
    deadline.abort(new DOMException('timed out', 'TimeoutError'));
    expect(seen[0]?.signal.aborted).toBe(true);
  }
);

test('keeps the caller able to abort the sync', async () => {
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
  const caller = new AbortController();
  const { base, seen } = capturing();

  await withSyncDeadline(base)(sync(SYNC, caller.signal));
  caller.abort();

  expect(seen[0]?.signal.aborted).toBe(true);
});

test('sends the sync body unchanged', async () => {
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
  const { base, seen } = capturing();

  await withSyncDeadline(base)(new Request(SYNC, { method: 'POST', body: '{"lists":{}}' }));

  expect(await seen[0]?.text()).toBe('{"lists":{}}');
});

test.each([
  ['a v3 sync', new Request(`${HOST}/_matrix/client/v3/sync`)],
  ['a media upload', new Request(`${HOST}/_matrix/media/v3/upload`, { method: 'POST' })],
  ['a room message', new Request(`${HOST}/_matrix/client/v3/rooms/!r/messages`)],
])('leaves %s alone', async (_name, request) => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const { base, calls } = capturing();

  await withSyncDeadline(base)(request);

  expect(calls[0]?.[0]).toBe(request);
  expect(timeout).not.toHaveBeenCalled();
});
