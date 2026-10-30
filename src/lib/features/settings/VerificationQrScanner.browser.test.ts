import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import fixture from './verification-qr.fixture.json' with { type: 'json' };
import { qrLayout } from './verification-qr';
import VerificationQrScanner from './VerificationQrScanner.svelte';

afterEach(() => {
  vi.restoreAllMocks();
});

test('scans verification bytes from a video stream and stops the camera', async () => {
  const layout = qrLayout(fixture.code);
  const scale = 6;
  const canvas = document.createElement('canvas');
  canvas.width = layout.size * scale;
  canvas.height = canvas.width;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas capture is unavailable');
  const stream = canvas.captureStream(10);
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);
  vi.spyOn(navigator.mediaDevices, 'enumerateDevices').mockResolvedValue([]);
  const onScan = vi.fn();

  try {
    const screen = await render(VerificationQrScanner, { onScan });
    const video = screen.getByLabelText('Looking for a code…').element() as HTMLVideoElement;
    await expect.poll(() => video.srcObject).toBe(stream);

    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    for (const [x, y] of layout.dark) {
      context.fillRect(x * scale, y * scale, scale, scale);
    }

    await expect.poll(() => onScan.mock.calls).toEqual([[new Uint8Array(fixture.payload)]]);
    expect(stream.getVideoTracks()[0]?.readyState).toBe('ended');
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
});
