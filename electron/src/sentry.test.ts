import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('@sentry/electron/main', () => ({ init }));

import { initSentry, readConsent, setTelemetryConsent } from './sentry';

type BeforeSend = (event: Record<string, unknown>) => Record<string, unknown> | null;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sable-sentry-'));
  init.mockClear();
  vi.stubGlobal('__SABLE_SENTRY__', { dsn: 'https://key@example.invalid/1', release: '1.0.0' });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function beforeSend(): BeforeSend {
  return (init.mock.calls[0][0] as { beforeSend: BeforeSend }).beforeSend;
}

test('no DSN leaves the SDK off', () => {
  vi.stubGlobal('__SABLE_SENTRY__', {});
  initSentry(dir);
  expect(init).not.toHaveBeenCalled();
});

test('events are dropped until the user consents', () => {
  initSentry(dir);

  expect(beforeSend()({ message: 'boom' })).toBeNull();

  setTelemetryConsent(true);
  expect(beforeSend()({ message: 'boom' })).toEqual({ message: 'boom' });

  setTelemetryConsent(false);
  expect(beforeSend()({ message: 'boom' })).toBeNull();
});

test('consent survives a restart', () => {
  initSentry(dir);
  setTelemetryConsent(true);

  expect(readConsent(join(dir, 'sentry-consent'))).toBe(true);
  expect(readFileSync(join(dir, 'sentry-consent'), 'utf8')).toBe('1');

  init.mockClear();
  initSentry(dir);
  expect(beforeSend()({ message: 'boom' })).not.toBeNull();
});

test('consented events have Matrix identifiers scrubbed', () => {
  initSentry(dir);
  setTelemetryConsent(true);

  const event = beforeSend()({ message: 'failed for @alice:example.org in !room:example.org' });

  expect(event?.message).not.toContain('alice');
  expect(event?.message).not.toContain('!room');
});
