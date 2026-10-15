import { scrubMatrixIds } from './scrubbers';

const TITLE_LIMIT = 600;
const OLM_ACCOUNT = 'matrix_sdk_crypto::olm::account:';

export type WasmLogLevel = 'error' | 'warn' | 'info';

export function wasmLogLevel(line: string): WasmLogLevel {
  const level = /^\s*(TRACE|DEBUG|INFO|WARN|ERROR)\s/.exec(line)?.[1];
  if (level === 'ERROR') return 'error';
  if (level === 'WARN') return 'warn';
  return 'info';
}

/** Only a warning in the SDK, but the room keys it carried are lost. */
export function isUndecryptableToDevice(line: string): boolean {
  return wasmLogLevel(line) === 'warn' && line.includes(OLM_ACCOUNT);
}

export function wasmErrorTitle(line: string): string {
  const message = scrubMatrixIds(
    line
      .replace(/^\s*(?:ERROR|WARN)\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
  return message.length > TITLE_LIMIT ? `${message.slice(0, TITLE_LIMIT)}…` : message;
}

export function wasmErrorFingerprint(line: string): string {
  return wasmErrorTitle(line)
    .replace(/\{[^{}]*\}/g, '')
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}
