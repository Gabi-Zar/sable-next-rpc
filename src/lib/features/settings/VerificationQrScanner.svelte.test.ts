// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import VerificationQrScanner from './VerificationQrScanner.svelte';

const decode = vi.hoisted(() => vi.fn<() => { binaryData: number[] } | null>(() => null));
vi.mock('jsqr', () => ({ default: decode }));

function camera(deviceId: string) {
  const stop = vi.fn();
  const track = { stop, getSettings: () => ({ deviceId }) };
  return { stop, stream: { getTracks: () => [track], getVideoTracks: () => [track] } };
}

function setup() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  } as unknown as CanvasRenderingContext2D);
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    Object.defineProperties(this, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(() => {});
  const front = camera('front');
  const rear = camera('rear');
  const getUserMedia = vi.fn().mockResolvedValueOnce(front.stream).mockResolvedValue(rear.stream);
  const enumerateDevices = vi.fn().mockResolvedValue([
    { kind: 'videoinput', deviceId: 'front', label: 'Front camera' },
    { kind: 'videoinput', deviceId: 'rear', label: 'Rear camera' },
    { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
  ]);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices },
  });
  return { front, rear, getUserMedia, enumerateDevices, play };
}

afterEach(() => {
  vi.restoreAllMocks();
  decode.mockReset().mockReturnValue(null);
});

test.each(['MATRIX', 'IO_ELEMENT_MSC4388'])(
  'scans %s codes without changing their bytes',
  async (header) => {
    const { front } = setup();
    const data = [...new TextEncoder().encode(header), 0x00, 0x80, 0xff];
    decode.mockReturnValue({ binaryData: data });
    const onScan = vi.fn();
    render(VerificationQrScanner, { onScan });

    await waitFor(() => {
      expect(onScan).toHaveBeenCalledExactlyOnceWith(new Uint8Array(data));
    });
    expect(front.stop).toHaveBeenCalledOnce();
  }
);

test.each(['MATRI', 'IO_ELEMENT_MSC438', 'IO_ELEMENT_MSC4389', 'https://example.org'])(
  'keeps scanning after an unrecognized header: %j',
  async (header) => {
    const { front } = setup();
    decode.mockReturnValue({ binaryData: [...new TextEncoder().encode(header)] });
    const onScan = vi.fn();
    render(VerificationQrScanner, { onScan });

    await waitFor(() => {
      expect(decode).toHaveBeenCalled();
    });
    expect(onScan).not.toHaveBeenCalled();
    expect(front.stop).not.toHaveBeenCalled();

    const data = [...new TextEncoder().encode('IO_ELEMENT_MSC4388'), 0x03, 0x00];
    decode.mockReturnValue({ binaryData: data });
    await waitFor(() => {
      expect(onScan).toHaveBeenCalledExactlyOnceWith(new Uint8Array(data));
    });
    expect(front.stop).toHaveBeenCalledOnce();
  }
);

async function chooseRear() {
  const user = userEvent.setup();
  const selector = await screen.findByRole('combobox', { name: 'Camera' });
  await waitFor(() => {
    expect(selector).toBeEnabled();
  });
  await user.click(selector);
  await user.click(await screen.findByRole('option', { name: 'Rear camera' }));
}

test('switches to the selected camera and releases both streams', async () => {
  const { front, rear, getUserMedia, enumerateDevices } = setup();
  const { unmount } = render(VerificationQrScanner, { onScan: vi.fn() });
  await chooseRear();
  await waitFor(() => {
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
  expect(getUserMedia).toHaveBeenLastCalledWith({
    audio: false,
    video: { deviceId: { exact: 'rear' } },
  });
  expect(front.stop).toHaveBeenCalledOnce();
  expect(enumerateDevices).toHaveBeenCalled();
  unmount();
  expect(rear.stop).toHaveBeenCalledOnce();
});

test('keeps the selector available after a camera fails', async () => {
  const { getUserMedia } = setup();
  getUserMedia.mockRejectedValueOnce(new Error('Camera busy'));
  render(VerificationQrScanner, { onScan: vi.fn() });
  await chooseRear();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Camera' })).toBeEnabled();
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Camera' }));
  await user.click(await screen.findByRole('option', { name: 'Front camera' }));
  await waitFor(() => {
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });
  await waitFor(() => {
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

test('releases a camera whose permission request completes after unmount', async () => {
  const { rear, getUserMedia } = setup();
  let resolve!: (stream: unknown) => void;
  getUserMedia.mockReset().mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { unmount } = render(VerificationQrScanner, { onScan: vi.fn() });
  await waitFor(() => {
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
  unmount();
  resolve(rear.stream);
  await waitFor(() => {
    expect(rear.stop).toHaveBeenCalledOnce();
  });
});

test('continues scanning if device enumeration is unavailable', async () => {
  const { enumerateDevices, play } = setup();
  enumerateDevices.mockRejectedValue(new Error('Not supported'));
  render(VerificationQrScanner, { onScan: vi.fn() });
  await waitFor(() => {
    expect(play).toHaveBeenCalled();
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Camera' })).not.toBeInTheDocument();
});
