<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import FileAudioIcon from 'phosphor-svelte/lib/FileAudioIcon';
  import PauseIcon from 'phosphor-svelte/lib/PauseIcon';
  import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
  import { onDestroy, onMount } from 'svelte';
  import { on } from 'svelte/events';

  interface Props {
    src: string;
    label: string;
    filename: string;
    attachedTop?: boolean;
  }

  const formatTimestamp = (currentTime: number): string => {
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

  let { src, label, filename, attachedTop = false }: Props = $props();

  const updateTime = () => {
    if (!seekUserIsInteracting) {
      seekPosition = player?.currentTime || 0;
    }
    requestAnimationFrame(updateTime);
  };

  onMount(() => {
    player = new Audio(src);
    requestAnimationFrame(updateTime);

    on(player, 'loadedmetadata', () => {
      if (player?.duration) {
        duration = player.duration;
      }
    });
  });

  onDestroy(() => {
    player?.pause();
    player = null;
  });
</script>

{#key player}
  <div
    class="audio-container {attachedTop
      ? 'audio-container-attached'
      : 'audio-container-unattached'}"
    aria-label={label}
  >
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
            player?.play();
            isPlaying = true;
          } else {
            player?.pause();
            isPlaying = false;
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
        <span class="audio-timestamp-duration"
          >{duration ? formatTimestamp(duration) : 'XX:XX'}</span
        >
      </p>
      <input
        type="range"
        min="0"
        max={player?.duration}
        step="0.01"
        value={seekPosition}
        aria-label={i18n.t('timeline.audioSeek')}
        onpointerdown={() => (seekUserIsInteracting = true)}
        onpointerup={() => (seekUserIsInteracting = false)}
        oninput={(e) => {
          if (player) {
            player.currentTime = +e.currentTarget.value;
            seekPosition = +e.currentTarget.value;
          }
        }}
      />
    </div>
  </div>
{/key}

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
    margin: var(--space-25) 0;

    &:hover {
      transform: scale(1.1);
    }
  }

  input[type='range'] {
    appearance: none;
    background: transparent;
    cursor: pointer;
    height: 24px;
  }

  /* webkit */
  input[type='range']::-webkit-slider-runnable-track {
    background-color: color-mix(in srgb, transparent 40%, var(--primary-main) 60%);
    border-radius: var(--radius-pill);
    height: 0.5rem;
  }

  input[type='range']::-webkit-slider-thumb {
    appearance: none;
    background-color: var(--primary-main);
    border-radius: var(--radius-pill);
    height: 1rem;
    margin-top: -4px;
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
