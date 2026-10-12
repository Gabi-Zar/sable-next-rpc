<script lang="ts">
  import { playSound, type NotificationSounds } from '#lib/features/notifications/sound.js';
  import { i18n } from '#lib/i18n.js';
  import {
    PREFERENCE_RANGES,
    preferences,
    setPreference,
    type RangePreference,
  } from '#lib/settings/preferences.svelte.js';
  import Slider from '#lib/ui/primitives/Slider.svelte';

  import '#lib/ui/primitives/settings-row.css';
  import BellIcon from 'phosphor-svelte/lib/BellIcon';
  import PhoneIcon from 'phosphor-svelte/lib/PhoneIcon';
  import { startRingback, startRingtone } from './ringtone.js';
  import type { Component } from 'svelte';

  const CATEGORIES = [
    {
      name: 'ring',
      label: 'sounds.volumeRingCategory',
    },
  ];

  type Sound = {
    label: string;
    preference: RangePreference;
    icon: Component;
    sound: keyof NotificationSounds | '$special/ringtone' | '$special/ringback';
    category?: string;
  };
  const SOUNDS: Sound[] = [
    {
      label: 'sounds.notification',
      preference: 'soundsNotificationVolume',
      icon: BellIcon,
      sound: 'notification',
    },
    {
      label: 'sounds.ringtone',
      preference: 'callRingtoneVolume',
      icon: PhoneIcon,
      sound: '$special/ringtone',
      category: 'ring',
    },
    {
      label: 'sounds.ringback',
      preference: 'callRingtoneVolume',
      icon: PhoneIcon,
      sound: '$special/ringback',
      category: 'ring',
    },
  ];

  let playing = false;

  async function playRingtone(): Promise<void> {
    const ringtone = startRingtone(preferences.callRingtoneVolume);
    await new Promise((resolve) => setTimeout(resolve, 500));
    ringtone.stop();
  }

  async function playRingback(): Promise<void> {
    const ringback = startRingback(preferences.callRingtoneVolume);
    await new Promise((resolve) => setTimeout(resolve, 500));
    ringback.stop();
  }
</script>

{#snippet soundSnippet(sound: Sound)}
  {@const Icon = sound.icon}
  <div class="row">
    <span class="label"><Icon aria-hidden="true" />{$i18n.t(sound.label)}</span>
    <div class="control" data-max-range={PREFERENCE_RANGES[sound.preference].max}>
      <Slider
        min={PREFERENCE_RANGES[sound.preference].min}
        max={PREFERENCE_RANGES[sound.preference].max}
        step={0.05}
        label={$i18n.t(sound.label)}
        value={preferences[sound.preference]}
        oninput={(value) => {
          preferences[sound.preference] = value;

          if (playing) return;
          playing = true;
          let callback: Promise<void>;
          if (sound.sound === '$special/ringtone') {
            callback = playRingtone();
          } else if (sound.sound === '$special/ringback') {
            callback = playRingback();
          } else {
            callback = playSound(sound.sound, { blocking: true });
          }

          callback
            .then(() => {
              playing = false;
            })
            .catch(() => {
              playing = false;
            });
        }}
      />

      <label class="form-control range-reading">
        <input
          class="range-input"
          type="number"
          inputmode="numeric"
          min={Math.round(PREFERENCE_RANGES[sound.preference].min * 100)}
          max={Math.round(PREFERENCE_RANGES[sound.preference].max * 100)}
          step={0.05}
          value={Math.round(preferences[sound.preference] * 100)}
          aria-label={$i18n.t('settings.rangePercent', { name: $i18n.t(sound.label) })}
          onchange={(event) => {
            const typed = Number(event.currentTarget.value) / 100;
            if (event.currentTarget.value !== '' && Number.isFinite(typed)) {
              const { min, max } = PREFERENCE_RANGES[sound.preference];
              const next = Math.min(max, Math.max(min, typed));
              setPreference(sound.preference, next);
            }
            event.currentTarget.value = String(Math.round(preferences[sound.preference] * 100));
          }}
        /><span class="range-suffix" aria-hidden="true">%</span>
      </label>
    </div>
  </div>
{/snippet}
<div class="settings-form">
  <div class="device-rows">
    {#each SOUNDS.filter((sound) => sound.category === undefined) as sound (sound.sound)}
      {@render soundSnippet(sound)}
    {/each}
    {#each CATEGORIES as category (category.name)}
      <h3>{$i18n.t(category.label)}</h3>
      {#each SOUNDS.filter((sound) => sound.category === category.name) as sound (sound.sound)}
        {@render soundSnippet(sound)}
      {/each}
    {/each}
  </div>
</div>

<style>
  .device-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-200);
  }

  .row {
    align-items: center;
    display: grid;
    gap: var(--space-200);
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .label {
    align-items: center;
    display: inline-flex;
    gap: var(--space-100);
  }

  .control {
    align-items: center;
    display: flex;
    gap: var(--space-150);
  }

  .control[data-max-range='2'] :global(.slider-track) {
    background: linear-gradient(
      to right,
      var(--surface-container) 0%,
      var(--surface-container) 50%,
      var(--crit-container) 70%,
      var(--crit-container) 100%
    );

    &:hover {
      background: linear-gradient(
        to right,
        var(--surface-container-hover) 0%,
        var(--surface-container-hover) 50%,
        var(--crit-container-hover) 70%,
        var(--crit-container-hover) 100%
      );
    }
  }
</style>
