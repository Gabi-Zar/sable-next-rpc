import { createRequire } from 'node:module';
import { join } from 'node:path';

interface NativeAudio {
  startScreenAudio(frames: (data: Buffer) => void): void;
  stopScreenAudio(): void;
}

let native: NativeAudio | undefined;
let generation = 0;

function backend(): NativeAudio {
  const load = createRequire(join(__dirname, 'main.cjs'));
  native ??= load('./sable_node.node') as NativeAudio;
  return native;
}

export function start(value: unknown, frames: (data: Buffer) => void): void {
  if (typeof value !== 'object' || value === null) throw new Error('invalid audio selection');
  const selection = value as Record<string, unknown>;
  if (selection.kind !== 'system') throw new Error('invalid audio selection');
  stop();
  const current = generation;
  backend().startScreenAudio((data) => {
    if (generation === current) frames(data);
  });
}

export function stop(): void {
  generation += 1;
  native?.stopScreenAudio();
}
