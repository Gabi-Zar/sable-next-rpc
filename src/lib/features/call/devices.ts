import { hasNativeCalls } from '#lib/platform/calls.js';
import { SCREEN_AUDIO_LABELS } from '#lib/platform/screen-audio.js';

export type CallDevice = {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
};

export const DEVICE_PREFERENCE = {
  audioinput: 'audioInputDevice',
  audiooutput: 'audioOutputDevice',
  videoinput: 'videoInputDevice',
} as const;

export function supportsDeviceSelection(): boolean {
  return (
    !hasNativeCalls() &&
    typeof navigator !== 'undefined' &&
    typeof (navigator.mediaDevices as MediaDevices | undefined)?.enumerateDevices === 'function'
  );
}

export async function listCallDevices(): Promise<{ devices: CallDevice[]; denied: boolean }> {
  if (!supportsDeviceSelection()) return { devices: [], denied: false };
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const seen = new Set<string>();
    const devices = all
      .filter((device) => device.deviceId !== '' && !SCREEN_AUDIO_LABELS.includes(device.label))
      .filter((device) => {
        const key = `${device.kind}:${device.deviceId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((device) => ({
        deviceId: device.deviceId,
        kind: device.kind,
        label: device.label,
      }));
    return { devices, denied: all.some((device) => device.label === '') };
  } catch (error) {
    console.debug('[sable call] could not enumerate devices', error);
    return { devices: [], denied: true };
  }
}

export async function unlockCallDevices(): Promise<string | null> {
  try {
    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
    for (const track of stream.getTracks()) track.stop();
    return null;
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn('[sable call] microphone access failed', reason);
    return reason;
  }
}
