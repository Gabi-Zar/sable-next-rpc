import { recordDebugLog } from '#lib/observability/debug-log.svelte.js';
import { preferences } from '#lib/settings/preferences.svelte.js';

export type NotificationSounds = {
  notification: string;
};

const SOUNDS: NotificationSounds = {
  notification: '/sound/notification.ogg',
};

/* All of the sounds are mixed at -5dB, we may want to tweak this */
const GAIN_MODIFIER = 1.2;

const RESUME_STALL_MS = 3000;

let context: AudioContext | undefined;
let playing: AudioBufferSourceNode | undefined;
let sounds: Map<keyof NotificationSounds, Promise<AudioBuffer> | null> = new Map();

export async function playNotificationSound(name: keyof NotificationSounds): Promise<void> {
  const audioContext = (context ??= new AudioContext());
  const soundPromise = sounds.getOrInsertComputed(name, () =>
    fetch(SOUNDS[name])
      .then((response) => response.arrayBuffer())
      .then((bytes) => audioContext.decodeAudioData(bytes))
  );

  try {
    const buffer = await soundPromise;
    if (context !== audioContext || playing !== undefined) {
      recordDebugLog('debug', 'notification', 'sound', 'skipped', {
        replaced: context !== audioContext,
        playing: playing !== undefined,
      });
      return;
    }
    if (audioContext.state !== 'running') {
      recordDebugLog('debug', 'notification', 'sound', 'resuming', { state: audioContext.state });
      const stalled = setTimeout(() => {
        console.warn('[sable notification sound] resume stalled', audioContext.state);
      }, RESUME_STALL_MS);
      try {
        await audioContext.resume();
      } finally {
        clearTimeout(stalled);
      }
    }
    if (context !== audioContext) return;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = audioContext.createGain();
    gain.gain.value = preferences.soundsNotificationVolume * GAIN_MODIFIER;
    source.connect(gain).connect(audioContext.destination);
    playing = source;
    source.addEventListener('ended', () => {
      if (playing === source) playing = undefined;
    });
    source.start();
    recordDebugLog('debug', 'notification', 'sound', 'started', {
      state: audioContext.state,
      volume: gain.gain.value,
    });
  } catch (error) {
    if (context === audioContext) {
      context = undefined;
      playing = undefined;
      sounds.set(name, null);
    }
    if (audioContext.state !== 'closed') void audioContext.close();
    throw error;
  }
}

export async function playSound(
  name: keyof NotificationSounds,
  options: { blocking?: boolean } = {}
): Promise<void> {
  const audioContext = (context ??= new AudioContext());
  const soundPromise = sounds.getOrInsertComputed(name, () =>
    fetch(SOUNDS[name])
      .then((response) => response.arrayBuffer())
      .then((bytes) => audioContext.decodeAudioData(bytes))
  );

  try {
    const buffer = await soundPromise;
    // if (context !== audioContext || playing !== undefined) {
    //   recordDebugLog('debug', 'notification', 'sound', 'skipped', {
    //     replaced: context !== audioContext,
    //     playing: playing !== undefined,
    //   });
    //   return;
    // }
    if (audioContext.state !== 'running') {
      recordDebugLog('debug', 'notification', 'sound', 'resuming', { state: audioContext.state });
      await audioContext.resume();
    }
    if (context !== audioContext) return;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = audioContext.createGain();
    gain.gain.value = preferences.soundsNotificationVolume * GAIN_MODIFIER;
    source.connect(gain).connect(audioContext.destination);
    playing = source;
    source.addEventListener('ended', () => {
      if (playing === source) playing = undefined;
    });
    source.start();
    recordDebugLog('debug', 'notification', 'sound', 'started', {
      state: audioContext.state,
      volume: gain.gain.value,
    });

    if (options.blocking) await new Promise((resolve) => (source.onended = resolve));
  } catch (error) {
    if (context === audioContext) {
      context = undefined;
      playing = undefined;
      sounds.set(name, null);
    }
    if (audioContext.state !== 'closed') void audioContext.close();
    throw error;
  }
}
