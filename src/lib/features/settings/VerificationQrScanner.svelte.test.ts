// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import VerificationQrScanner from './VerificationQrScanner.svelte';

vi.mock('jsqr', () => ({ default: vi.fn(() => null) }));

function camera(deviceId: string) {
  const stop = vi.fn();
  const track = { stop, getSettings: () => ({ deviceId }) };
  return { stop, stream: { getTracks: () => [track], getVideoTracks: () => [track] } };
}

function setup() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D
  );
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
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

afterEach(() => vi.restoreAllMocks());

async function chooseRear() {
  const user = userEvent.setup();
  const selector = await screen.findByRole('button', { name: 'Camera' });
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
  expect(screen.getByRole('button', { name: 'Camera' })).toBeEnabled();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Camera' }));
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
  expect(screen.queryByRole('button', { name: 'Camera' })).not.toBeInTheDocument();
});
