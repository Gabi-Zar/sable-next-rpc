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

const REPORTABLE_WARNINGS = [
  'unable to decrypt a message',
  'no call media key has arrived',
  'a call media key is still unresolved',
  'ignoring a call media key',
  'a call member did not receive the media key',
  'some call members did not receive the media key',
  'could not send the call media key',
  'call member device is unknown',
  'matrix_sdk_crypto::session_manager::sessions:',
  'matrix_sdk_crypto::session_manager::group_sessions:',
  'matrix_sdk_crypto::gossiping::',
];

/** Warnings that explain a message or a call that could not be decrypted. */
export function isReportableCoreWarning(line: string): boolean {
  return wasmLogLevel(line) === 'warn' && REPORTABLE_WARNINGS.some((part) => line.includes(part));
}

const UNREACHABLE =
  /Failed to fetch|Load failed|NetworkError|error sending request for url|tcp connect error|dns error|connection (?:refused|reset|closed)|operation timed out/i;
const SERVER_UNAVAILABLE = /status_code:\s*(?:429|5\d\d)\b|returned an error: \[(?:429|5\d\d)\b/;

export function isExpectedCoreFailure(line: string): boolean {
  return (
    UNREACHABLE.test(line) ||
    SERVER_UNAVAILABLE.test(line) ||
    /invalid_grant|refresh token was rejected/.test(line) ||
    line.includes('Failed to return /publicRooms') ||
    line.includes('The store is closed')
  );
}

export function wasmErrorTitle(line: string): string {
  const message = scrubMatrixIds(
    line
      .replace(/^\s*(?:ERROR|WARN)\s+/, '')
      .replace(/"?JsValue\([^]*$/, '')
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
