<script lang="ts">
  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import SettingsRow from '#lib/ui/primitives/SettingsRow.svelte';
  import SettingsSection from '#lib/ui/primitives/SettingsSection.svelte';
  import '#lib/ui/primitives/settings-row.css';

  const core = useCoreClient();
  const info = await core.rpc.session.homeserverInfo().catch((error: unknown) => {
    console.debug('[sable settings] homeserver info unavailable', error);
    return null;
  });
</script>

{#if info}
  <SettingsSection title={i18n.t('settings.aboutHomeserver')} headingId="about-homeserver">
    <ul class="settings">
      <SettingsRow id="homeserver-url" title={i18n.t('settings.aboutHomeserverUrl')}>
        <span class="value">{info.homeserver.replace(/\/+$/, '')}</span>
      </SettingsRow>
      <SettingsRow id="homeserver-software" title={i18n.t('settings.aboutHomeserverSoftware')}>
        <span class="value">{info.server?.name ?? i18n.t('settings.aboutHomeserverUnknown')}</span>
      </SettingsRow>
      <SettingsRow id="homeserver-version" title={i18n.t('settings.aboutHomeserverVersion')}>
        <span class="value"
          >{info.server?.version ?? i18n.t('settings.aboutHomeserverUnknown')}</span
        >
      </SettingsRow>
    </ul>
  </SettingsSection>
{/if}

<style>
  .settings {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .value {
    color: var(--surface-var-on-container);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-small);
    font-variant-ligatures: none;
    overflow-wrap: anywhere;
  }
</style>
