<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import FileAudioIcon from 'phosphor-svelte/lib/FileAudioIcon';
  import PauseIcon from 'phosphor-svelte/lib/PauseIcon';
  import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
  import { onDestroy, onMount } from 'svelte';

  interface Props {
    src: string;
    label: string;
    filename: string;
    attachedTop?: boolean;
  }

  const formatTimestamp = (currentTime: number): string => {
    if (!Number.isFinite(currentTime)) {
      return '??:??';
    }
    currentTime = Math.floor(currentTime);
    const mm = Math.floor(currentTime / 60)
      .toString()
      .padStart(2, '0');
    const ss = (currentTime % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  let player: HTMLAudioElement | null = $state(null);
  let duration: number | null = $state(null);
  let isPlaying = $state(false);
  let seekPosition = $state(0);
  let seekUserIsInteracting = $state(false);
  let animationId: number | null;

  let { src, label, filename, attachedTop = false }: Props = $props();

  const updateTime = () => {
    if (!seekUserIsInteracting && player) {
      seekPosition = player?.currentTime || 0;
    }
    animationId = requestAnimationFrame(updateTime);
  };

  onMount(() => {
    animationId = requestAnimationFrame(updateTime);
  });

  onDestroy(() => {
    player?.pause();
    player = null;
    if (animationId) cancelAnimationFrame(animationId);
  });
</script>

<div
  class="audio-container {attachedTop ? 'audio-container-attached' : 'audio-container-unattached'}"
  aria-label={label}
>
  <audio
    bind:this={player}
    {src}
    preload="metadata"
    aria-hidden="true"
    onloadedmetadata={() => {
      if (player?.duration) {
        duration = player.duration;
      }
    }}
    onplay={() => (isPlaying = true)}
    onpause={() => (isPlaying = false)}
    onended={() => (isPlaying = false)}
  >
  </audio>
  {#if !attachedTop}
    <div class="audio-header">
      <FileAudioIcon size={24} />
      <span class="audio-filename">{filename}</span>
    </div>
  {/if}

  <div class="audio-controls">
    <button
      class="audio-play-button"
      type="button"
      aria-label={i18n.t('timeline.playAudio', { name: label })}
      onclick={() => {
        if (!isPlaying) {
          try {
            player?.play();
          } catch (err) {
            console.warn("[sable media] audio playback couldn't start: ", err);
          }
        } else {
          player?.pause();
        }
      }}
    >
      {#if isPlaying}
        <PauseIcon weight="fill" />
      {:else}
        <PlayIcon weight="fill" />
      {/if}
    </button>
    <p class="audio-timestamp">
      {formatTimestamp(seekPosition)} /
      <span class="audio-timestamp-duration">{duration ? formatTimestamp(duration) : 'XX:XX'}</span>
    </p>
    <input
      type="range"
      min="0"
      max={duration ?? 0}
      step="0.01"
      value={seekPosition}
      aria-label={i18n.t('timeline.audioSeek')}
      onpointerdown={() => (seekUserIsInteracting = true)}
      onpointerup={() => (seekUserIsInteracting = false)}
      onpointercancel={() => (seekUserIsInteracting = false)}
      oninput={(e) => {
        if (player) {
          player.currentTime = +e.currentTarget.value;
          seekPosition = +e.currentTarget.value;
        }
      }}
    />
  </div>
</div>

<style>
  .audio-container {
    background-color: var(--surface-var-container);
    display: flex;
    flex-direction: column;
    gap: var(--space-200);
    padding: var(--space-250);
  }

  .audio-container-attached {
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .audio-container-unattached {
    border-radius: var(--radius);
  }

  .audio-header {
    align-items: center;
    display: flex;
    gap: var(--space-100);
  }

  .audio-controls {
    align-items: center;
    display: flex;
    gap: var(--space-200);

    input {
      width: 100%;
    }
  }

  .audio-filename {
    font-size: var(--font-size-small);
    opacity: 0.8;
  }

  .audio-timestamp {
    flex-shrink: 0;
    font-size: var(--font-size-small);
    margin: 0;
    opacity: 0.8;
  }

  .audio-timestamp-duration {
    opacity: 0.8;
  }

  .audio-play-button {
    align-items: center;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    justify-content: center;

    @media (prefers-reduced-motion: no-preference) {
      &:hover {
        transform: scale(1.1);
      }
    }
  }

  input[type='range'] {
    appearance: none;
    background: transparent;
    cursor: pointer;
    height: 24px;
  }

  .audio-play-button:focus-visible,
  input[type='range']:focus-visible {
    border-radius: var(--radius);
    outline: var(--focus-ring-width) solid var(--surface-container-line);
    outline-offset: var(--focus-ring-offset);
  }

  /* webkit */
  input[type='range']::-webkit-slider-runnable-track {
    background-color: color-mix(in srgb, transparent 40%, var(--primary-main) 60%);
    border-radius: var(--radius-pill);
    height: 0.5rem;
  }

  input[type='range']::-webkit-slider-thumb {
    /*
        https://www.smashingmagazine.com/2021/12/create-custom-range-input-consistent-browsers/
        margin-top = (track height in pixels / 2) - (thumb height in pixels /2)
      */
    --webkit-thumb-nudge: calc((0.5rem / 2) - (1rem / 2));

    appearance: none;
    background-color: var(--primary-main);
    border-radius: var(--radius-pill);
    height: 1rem;
    margin-top: var(--webkit-thumb-nudge);
    width: 1rem;
  }

  /* firefox */
  input[type='range']::-moz-range-track {
    background-color: color-mix(in srgb, transparent 40%, var(--primary-main) 60%);
    border-radius: var(--radius-pill);
    height: 0.5rem;
  }

  input[type='range']::-moz-range-thumb {
    background-color: var(--primary-main);
    border: none;
    border-radius: var(--radius-pill);
    height: 1rem;
    width: 1rem;
  }
</style>
