<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import { preferences, setPreference } from '#lib/settings/preferences.svelte.js';
  import SettingsRow from '#lib/ui/primitives/SettingsRow.svelte';
  import Switch from '#lib/ui/primitives/Switch.svelte';
  import FontChoice from './FontChoice.svelte';
  import '#lib/ui/primitives/settings-row.css';
</script>

<div class="font-settings settings-form">
  <FontChoice
    id="font-family"
    title={i18n.t('settings.fontFamily')}
    hint={i18n.t('settings.fontFamilyHint')}
    value={preferences.fontFamily}
    systemFamily="system-ui"
    example="IBM Plex Mono"
    onValueChange={(value) => setPreference('fontFamily', value)}
  />
  <FontChoice
    id="font-family-mono"
    title={i18n.t('settings.fontFamilyMono')}
    hint={i18n.t('settings.fontFamilyMonoHint')}
    value={preferences.fontFamilyMono}
    systemFamily="monospace"
    example="IBM Plex Mono"
    onValueChange={(value) => setPreference('fontFamilyMono', value)}
  />
</div>

<ul class="settings-rows">
  <SettingsRow
    id="code-ligatures"
    key="codeLigatures"
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
</ul>

<style>
  .font-settings {
    display: grid;
    gap: var(--space-400);
    padding: var(--space-150) var(--space-400);
  }
</style>
