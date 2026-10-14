<script lang="ts">
  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import { setPreference } from '#lib/settings/preferences.svelte.js';
  import { SETTINGS_ACCOUNT_DATA_TYPE } from '#lib/settings/sync.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import Spinner from '#lib/ui/primitives/Spinner.svelte';
  import AuthField from '../shared/AuthField.svelte';
  import AuthInfoBox from '../shared/AuthInfoBox.svelte';
  import AuthSecondaryAction from '../shared/AuthSecondaryAction.svelte';
  import AuthStatusSlot from '../shared/AuthStatusSlot.svelte';

  interface Props {
    onComplete: () => void;
    onSkip: () => void;
  }

  let { onComplete, onSkip }: Props = $props();
  const core = useCoreClient();

  function turnOn(): void {
    setPreference('settingsSync', true);
    onComplete();
  }
</script>

<div class="settings-sync-card auth-card-surface">
  <AuthField labelId="settings-sync-title" label={i18n.t('settings.settingsSync')}>
    <AuthInfoBox>{i18n.t('setup.syncDescription')}</AuthInfoBox>
  </AuthField>

  <svelte:boundary>
    {@const synced = await core.rpc.account
      .data({ event_type: SETTINGS_ACCOUNT_DATA_TYPE })
      .then((content) => typeof content === 'object' && content !== null)
      .catch((error: unknown) => {
        console.debug('[sable setup] synced settings unavailable', error);
        return false;
      })}
    {#if synced}
      <AuthInfoBox>{i18n.t('setup.syncFound')}</AuthInfoBox>
    {/if}

    <AuthStatusSlot />

    <Button variant="primary" block onclick={turnOn}>
      {i18n.t(synced ? 'setup.syncAdopt' : 'setup.syncTurnOn')}
    </Button>

    {#snippet pending()}
      <AuthInfoBox><Spinner small />{i18n.t('setup.syncChecking')}</AuthInfoBox>

      <AuthStatusSlot />

      <Button variant="primary" block disabled>
        {i18n.t('setup.syncTurnOn')}
      </Button>
    {/snippet}
  </svelte:boundary>
</div>

<AuthSecondaryAction label={i18n.t('setup.syncNotNow')} onclick={onSkip} />

<style>
  .settings-sync-card {
    min-width: 0;
  }
</style>
