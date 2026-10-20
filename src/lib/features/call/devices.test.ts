import { afterEach, describe, expect, it, vi } from 'vitest';

import { listCallDevices } from './devices';

function device(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: '', toJSON: () => ({}) };
}

describe('listCallDevices', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists a device Firefox enumerates twice only once', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: () =>
          Promise.resolve([
            device('audiooutput', 'speaker', 'MacBook Pro Speakers'),
            device('audiooutput', 'speaker', 'MacBook Pro Speakers'),
            device('audioinput', 'speaker', 'Same id, other kind'),
          ]),
      },
    });

    const { devices } = await listCallDevices();

    expect(devices.map(({ kind, deviceId }) => `${kind}:${deviceId}`)).toEqual([
      'audiooutput:speaker',
      'audioinput:speaker',
    ]);
  });

  it('is not denied when only a camera is unnamed', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: () =>
          Promise.resolve([
            device('audioinput', 'mic', 'USB microphone'),
            device('videoinput', 'camera', ''),
          ]),
      },
    });

    expect((await listCallDevices()).denied).toBe(false);
  });

  it('is denied when a microphone is unnamed', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: () => Promise.resolve([device('audioinput', 'mic', '')]),
      },
    });

    expect((await listCallDevices()).denied).toBe(true);
  });
});
