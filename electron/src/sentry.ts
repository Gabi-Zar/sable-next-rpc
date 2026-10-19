import * as Sentry from '@sentry/electron/main';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { sanitizePayload, scrubMatrixIds } from '../../src/lib/observability/scrubbers';
import { scrubSentryEvent } from '../../src/lib/observability/sentry-event';

declare const __SABLE_SENTRY__: { dsn?: string; environment?: string; release?: string };

let consentPath: string | undefined;
let consent = false;

export function readConsent(path: string): boolean {
  try {
    return readFileSync(path, 'utf8') === '1';
  } catch {
    return false;
  }
}

export function initSentry(userDataDir: string): void {
  const { dsn, environment, release } = __SABLE_SENTRY__;
  if (!dsn) return;
  consentPath = join(userDataDir, 'sentry-consent');
  consent = readConsent(consentPath);

  Sentry.init({
    dsn,
    environment,
    release,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
    // The SDK pins @sentry/core 11.7 while the web app resolves 11.8, so the
    // two Event types differ nominally despite the same shape.
    beforeSend: (event) =>
      consent
        ? (scrubSentryEvent(event as Parameters<typeof scrubSentryEvent>[0]) as typeof event)
        : null,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.message) breadcrumb.message = scrubMatrixIds(breadcrumb.message);
      if (breadcrumb.data)
        breadcrumb.data = sanitizePayload(breadcrumb.data) as typeof breadcrumb.data;
      return breadcrumb;
    },
  });
}

export function setTelemetryConsent(enabled: boolean): void {
  if (!consentPath) return;
  consent = enabled;
  mkdirSync(dirname(consentPath), { recursive: true });
  writeFileSync(consentPath, enabled ? '1' : '0');
}
