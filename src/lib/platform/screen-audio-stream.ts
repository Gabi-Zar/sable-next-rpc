import { electronBridge } from './electron';
import workletUrl from './screen-audio-worklet.js?url&no-inline';

export type ScreenAudioChoice =
  | { kind: 'none' }
  | { kind: 'system'; exclude: string[]; workaround?: boolean }
  | { kind: 'apps'; include: string[]; workaround?: boolean };

const SAMPLE_RATE = 48_000;

let active: { stop: () => Promise<void> } | null = null;

export async function startScreenAudioStream(
  selection: Exclude<ScreenAudioChoice, { kind: 'none' }>
): Promise<MediaStreamTrack> {
  const electron = electronBridge();
  if (!electron) throw new Error('screen audio stream unsupported');
  await stopScreenAudioStream();
  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  let unsubscribe: (() => void) | undefined;
  const stop = async (): Promise<void> => {
    unsubscribe?.();
    await context.close().catch((error: unknown) => {
      console.debug('[sable call] screen audio context not closed', error);
    });
    await electron.stopScreenAudio();
  };
  active = { stop };

  try {
    await context.audioWorklet.addModule(workletUrl);
    const player = new AudioWorkletNode(context, 'sable-screen-audio-player', {
      numberOfInputs: 0,
      outputChannelCount: [2],
    });
    const destination = new MediaStreamAudioDestinationNode(context, {
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    player.connect(destination);
    const receive = (data: ArrayBuffer) => {
      if (data.byteLength === 0) {
        if (active?.stop === stop) void stopScreenAudioStream();
        return;
      }
      try {
        const samples = new Float32Array(data);
        player.port.postMessage(samples, [samples.buffer]);
      } catch (error) {
        console.warn('[sable call] dropped a screen audio chunk', error);
      }
    };
    unsubscribe = electron.onScreenAudioFrames(receive);
    await context.resume();
    await electron.startScreenAudioStream(selection);
    const track = destination.stream.getAudioTracks().at(0);
    if (!track) throw new Error('screen audio stream gave no track');
    return track;
  } catch (error) {
    await stopScreenAudioStream();
    throw error;
  }
}

export async function stopScreenAudioStream(): Promise<void> {
  const current = active;
  active = null;
  await current?.stop();
}
