import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app } from 'electron';

interface NativeAudio {
  startScreenAudio(audioPid: number, frames: (data: Buffer) => void): void;
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
  const audioPid = app.getAppMetrics().find((entry) => entry.name === 'Audio Service')?.pid;
  if (!audioPid) throw new Error('Sable audio service is unavailable');
  const current = generation;
  backend().startScreenAudio(audioPid, (data) => {
    if (generation === current) frames(data);
  });
}

export function stop(): void {
  generation += 1;
  native?.stopScreenAudio();
}
