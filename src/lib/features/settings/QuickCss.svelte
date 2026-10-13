<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import { preferences, setPreference } from '#lib/settings/preferences.svelte.js';
  import SettingsAnchorLink from '#lib/ui/primitives/SettingsAnchorLink.svelte';
  import TextArea from '#lib/ui/primitives/TextArea.svelte';
  import '#lib/ui/primitives/settings-row.css';
</script>

<div class="quick-css settings-form">
  <div class="settings-heading-row">
    <label for="quick-css">{$i18n.t('settings.quickCss')}</label>
    <SettingsAnchorLink anchor="quick-css" />
  </div>
  <TextArea
    id="quick-css"
    rows={10}
    spellcheck={false}
    value={preferences.quickCss}
    aria-describedby="quick-css-hint"
    oninput={(event) => {
      setPreference('quickCss', event.currentTarget.value);
    }}
  />
  <p id="quick-css-hint">{$i18n.t('settings.quickCssHint')}</p>
</div>

<style>
  .quick-css {
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
