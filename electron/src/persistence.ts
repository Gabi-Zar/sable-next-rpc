import writeFileAtomic from 'write-file-atomic';

const pending = new Set<Promise<void>>();
let flushing = false;

export function writeJson(path: string, value: unknown): Promise<void> {
  const write = writeFileAtomic(path, JSON.stringify(value));
  pending.add(write);
  const settled = () => pending.delete(write);
  void write.then(settled, settled);
  return write;
}

export async function flushWrites(): Promise<void> {
  while (pending.size) await Promise.allSettled(pending);
}

export function flushWritesBeforeQuit(
  event: { preventDefault: () => void },
  quit: () => void
): void {
  if (!pending.size) return;
  event.preventDefault();
  if (flushing) return;
  flushing = true;
  void flushWrites().then(() => {
    flushing = false;
    quit();
  });
}
