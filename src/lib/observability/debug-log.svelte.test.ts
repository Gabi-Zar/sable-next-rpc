import { afterEach, expect, test, vi } from 'vitest';

const originalConsole = console;

test('debug logging starts and changes settings without localStorage', async () => {
  vi.stubGlobal('localStorage', null);
  const { setDebugLogging, setDebugCategoryEnabled } = await import('./debug-log.svelte.js');
  expect(() => {
    setDebugLogging(true);
    setDebugCategoryEnabled('sync', false);
    setDebugLogging(false);
  }).not.toThrow();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  globalThis.console = originalConsole;
});

test('does not recursively capture console output', async () => {
  let reentered = false;
  const info = vi.fn(() => {
    if (!reentered) {
      reentered = true;
      console.info('nested log');
    }
  });
  vi.stubGlobal('console', { ...originalConsole, info });

  const { debugLog, setDebugLogging } = await import('./debug-log.svelte.js');
  setDebugLogging(true);
  console.info('outer log');
  await Promise.resolve();

  expect(info).toHaveBeenCalledTimes(2);
  expect(debugLog.entries).toHaveLength(1);
  expect(debugLog.entries[0]?.message).toBe('outer log');
});

test('keeps every line of a burst and never grows past the cap', async () => {
  const { debugLog, setDebugLogging } = await import('./debug-log.svelte.js');
  setDebugLogging(true);
  for (let index = 0; index < 5000; index += 1) console.error(`flood ${index}`);

  expect(debugLog.entries.length).toBeGreaterThanOrEqual(1000);
  expect(debugLog.entries.length).toBeLessThanOrEqual(1200);
  expect(debugLog.entries.at(-1)?.message).toBe('flood 4999');
});

test('dedupes consecutive identical console lines', async () => {
  const { debugLog, setDebugLogging } = await import('./debug-log.svelte.js');
  setDebugLogging(true);
  console.error('spinning');
  console.error('spinning');
  console.error('spinning');
  await Promise.resolve();

  expect(debugLog.entries.filter((entry) => entry.message === 'spinning')).toHaveLength(1);
});

test('clearing lets an identical line be recorded again', async () => {
  const { clearDebugLogs, debugLog, setDebugLogging } = await import('./debug-log.svelte.js');
  setDebugLogging(true);
  console.error('same line');
  clearDebugLogs();
  console.error('same line');

  expect(debugLog.entries.filter((entry) => entry.message === 'same line')).toHaveLength(1);
});

test('scrubs LiveKit details when recording and exporting logs', async () => {
  const { recordDebugLog, exportDebugLogs, debugLog, setDebugLogging } =
    await import('./debug-log.svelte.js');
  const entry = {
    id: 1,
    timestamp: 0,
    level: 'debug' as const,
    category: 'general' as const,
    namespace: 'livekit',
    message: 'signal connecting to wss://private.example/rtc/v1?join_request=private-request',
    data: { join_request: 'private-request', url: 'wss://private.example/rtc/v1' },
  };
  setDebugLogging(true);
  recordDebugLog(entry.level, entry.category, entry.namespace, entry.message, entry.data);
  expect(JSON.stringify(debugLog.entries)).not.toContain('private');
  const exported = exportDebugLogs([entry]);
  expect(exported).not.toContain('private');
  expect(exported).toContain('join_request=[REDACTED]');
  expect(exported).toContain('wss://[SERVER]/rtc/v1');
});

test('removes structured join requests from captured console arguments', async () => {
  const { debugLog, setDebugLogging } = await import('./debug-log.svelte.js');
  setDebugLogging(true);
  console.info('signal connecting', {
    url: 'wss://private.example/rtc/v1',
    joinRequest: { participant: 'private', clientInfo: 'private' },
    accessToken: 'private-token',
    reconnect: false,
  });
  const message = debugLog.entries[0]?.message;
  expect(message).not.toContain('private');
  expect(message).not.toContain('joinRequest');
  expect(message).toContain('wss://[SERVER]/rtc/v1');
  expect(message).toContain('"reconnect":false');
});
