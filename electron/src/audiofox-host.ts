import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { AudioRequest, AudioResponse } from './audiofox-protocol';

interface NativeAudiofox {
  audiofoxApps(rootPid: number): string[];
  startAudiofox(include: string[], rootPid: number, frames: (data: Buffer) => void): void;
  stopAudiofox(): void;
}

let native: NativeAudiofox | undefined;
let inFlight = false;
const port = process.parentPort;
const send = (message: AudioResponse): void => {
  port.postMessage(message);
};

port.on('message', ({ data }: { data: AudioRequest | { command: 'ack' } }) => {
  if (data.command === 'ack') {
    inFlight = false;
    return;
  }
  if (data.command === 'stop') {
    native?.stopAudiofox();
    process.exit(0);
  }
  try {
    native ??= createRequire(join(__dirname, 'audiofox-host.cjs'))(
      './sable_audiofox.node'
    ) as NativeAudiofox;
    let value: string[] | undefined;
    if (data.command === 'list') value = native.audiofoxApps(data.rootPid);
    else
      native.startAudiofox(data.include, data.rootPid, (chunk) => {
        if (inFlight && chunk.byteLength > 0) return;
        inFlight = true;
        send({ type: 'frames', data: chunk });
      });
    send({ type: 'reply', id: data.id, value });
  } catch (error) {
    send({
      type: 'reply',
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
