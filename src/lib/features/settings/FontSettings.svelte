<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import { preferences, setPreference } from '#lib/settings/preferences.svelte.js';
  import SettingsAnchorLink from '#lib/ui/primitives/SettingsAnchorLink.svelte';
  import SettingsRow from '#lib/ui/primitives/SettingsRow.svelte';
  import Switch from '#lib/ui/primitives/Switch.svelte';
  import TextInput from '#lib/ui/primitives/TextInput.svelte';
  import '#lib/ui/primitives/settings-row.css';
</script>

<div class="font-settings settings-form">
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

  <div class="settings-heading-row">
    <label for="font-family-mono">{i18n.t('settings.fontFamilyMono')}</label>
    <SettingsAnchorLink anchor="font-family-mono" />
  </div>
  <TextInput
    id="font-family-mono"
    autocomplete="off"
    spellcheck={false}
    value={preferences.fontFamilyMono}
    aria-describedby="font-family-mono-hint"
    oninput={(event) => {
      setPreference('fontFamilyMono', event.currentTarget.value);
    }}
  />
  <p id="font-family-mono-hint">{i18n.t('settings.fontFamilyMonoHint')}</p>
</div>

<SettingsRow
  id="code-ligatures"
  title={i18n.t('settings.codeLigatures')}
  description={i18n.t('settings.codeLigaturesHint')}
>
  <Switch
    id="code-ligatures"
    label={i18n.t('settings.codeLigatures')}
    checked={preferences.codeLigatures}
    onCheckedChange={(checked) => {
      setPreference('codeLigatures', checked);
    }}
  />
</SettingsRow>

<style>
  .font-settings {
    display: grid;
    gap: var(--space-150);
    padding: var(--space-150) var(--space-400);
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
