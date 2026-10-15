// @vitest-environment happy-dom

import { flushSync } from 'svelte';
import { beforeEach, expect, test, vi } from 'vitest';

type Scheme = 'dark' | 'light' | null;

const native = vi.hoisted(() => ({
  os: 'linux',
  mediaDark: false,
  emit: null as ((event: { payload: Scheme }) => void) | null,
  invoke: vi.fn<(command: string) => Promise<Scheme>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => native.os }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_event: string, callback: (event: { payload: Scheme }) => void) => {
    native.emit = callback;
    return Promise.resolve(() => {});
  },
}));
vi.mock('svelte/reactivity', async (original) => ({
  ...(await original<typeof import('svelte/reactivity')>()),
  MediaQuery: class {
    get current(): boolean {
      return native.mediaDark;
    }
  },
}));

import { systemDark } from './system-theme.js';

beforeEach(() => {
  native.os = 'linux';
  native.mediaDark = false;
  native.emit = null;
  native.invoke.mockReset().mockResolvedValue(null);
});

async function track(): Promise<{ seen: boolean[]; stop: () => void }> {
  const seen: boolean[] = [];
  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(systemDark.current);
    });
  });
  flushSync();
  await vi.waitFor(() => {
    expect(native.invoke).toHaveBeenCalled();
  });
  await Promise.resolve();
  flushSync();
  return { seen, stop };
}

test('falls back to prefers-color-scheme without a portal preference', async () => {
  native.mediaDark = true;
  const { seen, stop } = await track();

  expect(native.invoke).toHaveBeenCalledWith('system_color_scheme');
  expect(seen.at(-1)).toBe(true);
  stop();
});

test('follows the portal scheme live', async () => {
  native.invoke.mockResolvedValue('dark');
  const { seen, stop } = await track();
  expect(seen.at(-1)).toBe(true);

  native.emit?.({ payload: 'light' });
  flushSync();
  expect(seen.at(-1)).toBe(false);

  native.mediaDark = true;
  native.emit?.({ payload: null });
  flushSync();
  expect(seen.at(-1)).toBe(true);
  stop();
});

test('keeps a pushed scheme over a slower startup read', async () => {
  let resolve: (scheme: Scheme) => void = () => {};
  native.invoke.mockReturnValue(new Promise((done) => (resolve = done)));
  const seen: boolean[] = [];
  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(systemDark.current);
    });
  });
  flushSync();
  await vi.waitFor(() => {
    expect(native.emit).not.toBeNull();
  });

  native.emit?.({ payload: 'dark' });
  resolve('light');
  await Promise.resolve();
  flushSync();

  expect(seen.at(-1)).toBe(true);
  stop();
});

test('asks nothing of the native side off Linux', () => {
  native.os = 'windows';
  native.mediaDark = true;
  let dark = false;
  const stop = $effect.root(() => {
    $effect(() => {
      dark = systemDark.current;
    });
  });
  flushSync();

  expect(dark).toBe(true);
  expect(native.invoke).not.toHaveBeenCalled();
  stop();
});
