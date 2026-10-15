import { collectSystemInfo } from '#lib/platform/diagnostics.js';
import { saveBytes, type SaveOutcome } from '#lib/platform/files.js';

import { buildDiagnosticsBundle } from './diagnostics-bundle.js';
import type { DebugLogEntry } from './debug-log.svelte.js';

export async function exportDiagnosticsBundle(
  entries: readonly DebugLogEntry[]
): Promise<SaveOutcome> {
  const systemInfo = await collectSystemInfo();
  const bundle = buildDiagnosticsBundle(entries, systemInfo);
  const filename = `sable-diagnostics-${String(Date.now())}.json`;
  return saveBytes(new TextEncoder().encode(bundle), filename, 'application/json');
}
