<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import { preferences, setPreference } from '#lib/settings/preferences.svelte.js';
  import SettingsAnchorLink from '#lib/ui/primitives/SettingsAnchorLink.svelte';
  import TextInput from '#lib/ui/primitives/TextInput.svelte';
  import '#lib/ui/primitives/settings-row.css';
</script>

<div class="font-family settings-form">
  <div class="settings-heading-row">
    <label for="font-family">{i18n.t('settings.fontFamily')}</label>
    <SettingsAnchorLink anchor="font-family" />
  </div>
  <TextInput
    id="font-family"
    autocomplete="off"
    spellcheck={false}
    value={preferences.fontFamily}
    aria-describedby="font-family-hint"
    oninput={(event) => {
      setPreference('fontFamily', event.currentTarget.value);
    }}
  />
  <p id="font-family-hint">{i18n.t('settings.fontFamilyHint')}</p>
</div>

<style>
  .font-family {
    display: grid;
    gap: var(--space-150);
  }

  label {
    font-size: var(--font-size-label);
    font-weight: var(--font-weight-medium);
  }

  p {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    margin: 0;
  }
</style>
