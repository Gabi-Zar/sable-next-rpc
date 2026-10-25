// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';

import { approveCapabilities, widgetPermissionKey } from './capabilities.js';
import type { RoomWidget } from './widget-content.js';

const SEND = 'org.matrix.msc2762.send.event:m.room.message#m.image';
const RECEIVE = 'org.matrix.msc2762.receive.event:m.room.message';
const OPENID = 'm.allow_openid';
const widget: RoomWidget = {
  id: 'gifs',
  type: 'm.custom',
  url: 'https://widgets.example/gifs',
  name: 'GIFs',
  data: {},
};
const key = widgetPermissionKey('@alice:example.org', '!room:example.org', widget, widget.url);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test('remembered approvals survive a reload', async () => {
  const prompt = vi.fn().mockResolvedValue({ approved: [SEND], remember: true });
  await expect(approveCapabilities(key, new Set([SEND]), prompt)).resolves.toEqual(new Set([SEND]));

  vi.resetModules();
  const reloaded = await import('./capabilities.js');
  prompt.mockClear();
  await expect(reloaded.approveCapabilities(key, new Set([SEND]), prompt)).resolves.toEqual(
    new Set([SEND])
  );
  expect(prompt).not.toHaveBeenCalled();
});

test('approvals are temporary unless remember is selected', async () => {
  const prompt = vi.fn().mockResolvedValue({ approved: [SEND], remember: false });
  await approveCapabilities(key, new Set([SEND]), prompt);
  await approveCapabilities(key, new Set([SEND]), prompt);

  expect(prompt).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(key)).toBeNull();
});

test('only approved capabilities are remembered', async () => {
  const prompt = vi.fn().mockResolvedValue({ approved: [SEND], remember: true });
  await approveCapabilities(key, new Set([SEND, RECEIVE, OPENID]), prompt);

  prompt.mockClear();
  prompt.mockResolvedValue({ approved: [], remember: false });
  await expect(approveCapabilities(key, new Set([SEND, RECEIVE, OPENID]), prompt)).resolves.toEqual(
    new Set([SEND])
  );
  expect(prompt).toHaveBeenCalledExactlyOnceWith([RECEIVE, OPENID]);
});

test('new approvals preserve permissions from earlier negotiations', async () => {
  const prompt = vi.fn().mockResolvedValue({ approved: [SEND], remember: true });
  await approveCapabilities(key, new Set([SEND]), prompt);

  prompt.mockResolvedValue({ approved: [OPENID], remember: true });
  await approveCapabilities(key, new Set([OPENID]), prompt);

  prompt.mockClear();
  await expect(approveCapabilities(key, new Set([SEND]), prompt)).resolves.toEqual(new Set([SEND]));
  expect(prompt).not.toHaveBeenCalled();
  await expect(approveCapabilities(key, new Set([SEND, OPENID]), prompt)).resolves.toEqual(
    new Set([SEND, OPENID])
  );
  expect(prompt).not.toHaveBeenCalled();
});

test('a temporary approval does not become remembered during a later negotiation', async () => {
  const prompt = vi.fn().mockResolvedValue({ approved: [SEND], remember: false });
  await approveCapabilities(key, new Set([SEND]), prompt);
  prompt.mockResolvedValue({ approved: [OPENID], remember: true });
  await approveCapabilities(key, new Set([OPENID]), prompt);

  prompt.mockClear();
  prompt.mockResolvedValue({ approved: [], remember: false });
  await expect(approveCapabilities(key, new Set([SEND, OPENID]), prompt)).resolves.toEqual(
    new Set([OPENID])
  );
  expect(prompt).toHaveBeenCalledExactlyOnceWith([SEND]);
});

test.each([
  ['account', '@bob:example.org', '!room:example.org', widget, widget.url],
  ['room', '@alice:example.org', '!other:example.org', widget, widget.url],
  ['id', '@alice:example.org', '!room:example.org', { ...widget, id: 'other' }, widget.url],
  ['type', '@alice:example.org', '!room:example.org', { ...widget, type: 'other' }, widget.url],
  [
    'template URL',
    '@alice:example.org',
    '!room:example.org',
    { ...widget, url: `${widget.url}?v=2` },
    widget.url,
  ],
  ['resolved URL', '@alice:example.org', '!room:example.org', widget, `${widget.url}?v=2`],
])('asks again when the widget %s changes', async (_name, userId, roomId, definition, url) => {
  const prompt = vi.fn().mockResolvedValue({ approved: [SEND], remember: true });
  await approveCapabilities(key, new Set([SEND]), prompt);

  prompt.mockClear();
  prompt.mockResolvedValue({ approved: [], remember: false });
  const changed = widgetPermissionKey(userId, roomId, definition, url);
  await expect(approveCapabilities(changed, new Set([SEND]), prompt)).resolves.toEqual(new Set());
  expect(prompt).toHaveBeenCalledExactlyOnceWith([SEND]);
});

test('matching capability prefixes do not grant broader access', async () => {
  const prompt = vi.fn().mockResolvedValue({ approved: [SEND], remember: true });
  await approveCapabilities(key, new Set([SEND]), prompt);

  const broader = 'org.matrix.msc2762.send.event:m.room.message';
  prompt.mockClear();
  prompt.mockResolvedValue({ approved: [], remember: false });
  await expect(approveCapabilities(key, new Set([broader]), prompt)).resolves.toEqual(new Set());
  expect(prompt).toHaveBeenCalledExactlyOnceWith([broader]);
});

test.each(['invalid JSON', '{}', '[true]'])(
  'ignores invalid stored permissions: %s',
  async (value) => {
    localStorage.setItem(key, value);
    const prompt = vi.fn().mockResolvedValue({ approved: [], remember: false });

    await expect(approveCapabilities(key, new Set([SEND]), prompt)).resolves.toEqual(new Set());
    expect(prompt).toHaveBeenCalledExactlyOnceWith([SEND]);
  }
);

test('storage failures leave the current approval usable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  const prompt = vi.fn().mockResolvedValue({ approved: [SEND], remember: true });

  await expect(approveCapabilities(key, new Set([SEND]), prompt)).resolves.toEqual(new Set([SEND]));
});

test('an empty request needs no approval', async () => {
  const prompt = vi.fn();
  await expect(approveCapabilities(key, new Set(), prompt)).resolves.toEqual(new Set());
  expect(prompt).not.toHaveBeenCalled();
});
