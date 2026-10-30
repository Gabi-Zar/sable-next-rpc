<script lang="ts">
  import { onMount } from 'svelte';

  import { i18n } from '#lib/i18n.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import Select from '#lib/ui/primitives/Select.svelte';

  interface Props {
    onScan: (data: Uint8Array) => void;
  }

  let { onScan }: Props = $props();

  const SCAN_INTERVAL_MS = 200;
  const STARTUP_TIMEOUT_MS = 10_000;
  const MAX_FRAME_EDGE = 720;
  const HEADERS = ['MATRIX', 'IO_ELEMENT_MSC4388'].map((header) =>
    new TextEncoder().encode(header)
  );

  let video = $state<HTMLVideoElement>();
  let failed = $state(false);
  let cameras = $state<MediaDeviceInfo[]>([]);
  let selectedCamera = $state('');
  let switching = $state(false);
  let switchCamera = $state<(deviceId: string) => void>(() => {});

  function isMatrixCode(data: number[]): boolean {
    return HEADERS.some((header) => header.every((byte, index) => data[index] === byte));
  }

  onMount(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let generation = 0;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    function stopStream(): void {
      clearInterval(timer);
      clearTimeout(startupTimer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = undefined;
      if (video) video.srcObject = null;
    }

    function fail(current: number, error: unknown): void {
      if (stopped || current !== generation) return;
      console.warn('[sable settings] QR camera startup failed', error);
      generation += 1;
      stopStream();
      failed = true;
      switching = false;
    }

    async function start(deviceId?: string): Promise<void> {
      const current = ++generation;
      switching = true;
      failed = false;
      stopStream();
      let next: MediaStream;
      try {
        next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
        });
      } catch (error) {
        fail(current, error);
        return;
      }
      if (stopped || current !== generation || !video) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = next;
      if (!context) {
        fail(current, new Error('Camera frame capture is unavailable'));
        return;
      }
      selectedCamera = next.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? '';
      // Camera labels and additional devices may only be available after permission is granted.
      void navigator.mediaDevices.enumerateDevices?.().then(
        (devices) => {
          if (!stopped && current === generation) {
            cameras = devices.filter((device) => device.kind === 'videoinput' && device.deviceId);
          }
        },
        () => {}
      );
      const element = video;
      startupTimer = setTimeout(() => {
        fail(current, new Error('Camera scanner startup timed out'));
      }, STARTUP_TIMEOUT_MS);
      let jsQR: typeof import('jsqr').default;
      try {
        element.srcObject = next;
        await element.play();
        if (stopped || current !== generation) return;
        ({ default: jsQR } = await import('jsqr'));
      } catch (error) {
        fail(current, error);
        return;
      }
      if (stopped || current !== generation) return;
      switching = false;

      timer = setInterval(() => {
        if (
          element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          !element.videoWidth ||
          !element.videoHeight
        )
          return;
        clearTimeout(startupTimer);
        const scale = Math.min(
          1,
          MAX_FRAME_EDGE / Math.max(element.videoWidth, element.videoHeight)
        );
        canvas.width = Math.round(element.videoWidth * scale);
        canvas.height = Math.round(element.videoHeight * scale);
        context.drawImage(element, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(frame.data, frame.width, frame.height, {
          inversionAttempts: 'dontInvert',
        });
        if (!found || !isMatrixCode(found.binaryData)) return;
        stopped = true;
        stopStream();
        onScan(new Uint8Array(found.binaryData));
      }, SCAN_INTERVAL_MS);
    }

    switchCamera = (deviceId) => void start(deviceId);
    void start();

    return () => {
      stopped = true;
      generation += 1;
      stopStream();
    };
  });
</script>

{#if cameras.length > 1}
  <Select
    items={cameras.map((camera, index) => ({
      value: camera.deviceId,
      label: camera.label || `${i18n.t('settings.callCameraDevice')} ${String(index + 1)}`,
      labelClass: 'literal-label',
    }))}
    value={selectedCamera}
    disabled={switching}
    aria-label={i18n.t('settings.callCameraDevice')}
    onValueChange={switchCamera}
  />
{/if}
<div class="verification-scanner" hidden={failed}>
  <video bind:this={video} autoplay muted playsinline aria-label={i18n.t('settings.scanningQr')}
  ></video>
</div>
{#if failed}
  <p class="verification-scanner-failed" role="alert">{i18n.t('settings.cameraUnavailable')}</p>
  <Button onclick={() => switchCamera(selectedCamera)}>{i18n.t('common.retry')}</Button>
{:else}
  <p class="verification-scanner-hint" role="status">{i18n.t('settings.scanningQr')}</p>
{/if}

<style>
  .verification-scanner {
    aspect-ratio: 1;
    background: var(--media-scrim-solid);
    border-radius: var(--radii-400);
    overflow: hidden;
    width: min(16rem, 100%);
  }

  .verification-scanner video {
    display: block;
    height: 100%;
    object-fit: cover;
    width: 100%;
  }

  .verification-scanner-hint,
  .verification-scanner-failed {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    margin: 0;
  }
</style>
