import { once } from 'node:events';
import { createInterface } from 'node:readline';

type ErrorSource = Pick<NodeJS.WritableStream, 'on'>;
const PANIC_MARKER = 'SABLE_CORE_PANIC ';

export function ignoreBrokenPipes(streams: readonly ErrorSource[]): void {
  for (const stream of streams) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && error.code !== 'EIO') throw error;
    });
  }
}

export function captureCorePanic(input: NodeJS.ReadableStream | null): Promise<string | undefined> {
  if (!input) return Promise.resolve(undefined);
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  let panic: string | undefined;
  lines.on('line', (line) => {
    if (line.startsWith(PANIC_MARKER)) panic ??= line.slice(PANIC_MARKER.length);
  });
  const close = () => {
    lines.close();
  };
  input.once('close', close);
  return once(lines, 'close')
    .then(() => panic)
    .finally(() => {
      input.removeListener('close', close);
      lines.close();
    });
}
