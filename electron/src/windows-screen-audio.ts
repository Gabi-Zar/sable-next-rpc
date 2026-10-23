import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { ScreenAudioListing } from '../../src/lib/platform/screen-audio-types';

interface NativeAudio {
  screenAudioApps(): string[];
  startScreenAudio(kind: string, include: string[], frames: (data: Buffer) => void): void;
  stopScreenAudio(): void;
}

let native: NativeAudio | undefined;
let generation = 0;

function backend(): NativeAudio {
  const load = createRequire(join(__dirname, 'main.cjs'));
  native ??= load('./sable_node.node') as NativeAudio;
  return native;
}

export function listApps(): ScreenAudioListing {
  return {
    status: 'available',
    apps: backend()
      .screenAudioApps()
      .map((name) => ({ id: name, label: name })),
  };
}

export function start(value: unknown, frames: (data: Buffer) => void): void {
  if (typeof value !== 'object' || value === null) throw new Error('invalid audio selection');
  const selection = value as Record<string, unknown>;
  if (selection.kind !== 'system' && selection.kind !== 'apps')
    throw new Error('invalid audio selection');
  const include = selection.include;
  if (
    selection.kind === 'apps' &&
    (!Array.isArray(include) || include.length !== 1 || typeof include[0] !== 'string')
  )
    throw new Error('Windows can share the sound of one application at a time');
  stop();
  const current = generation;
  backend().startScreenAudio(
    selection.kind,
    selection.kind === 'apps' ? (include as string[]) : [],
    (data) => {
      if (generation === current) frames(data);
    }
  );
}

export function stop(): void {
  generation += 1;
  native?.stopScreenAudio();
}
