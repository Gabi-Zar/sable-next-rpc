<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import { useCoreClient } from '#lib/core/context.js';
  import { supporter } from '#lib/supporter/supporter.svelte.js';
  import SupporterBadge from '#lib/supporter/SupporterBadge.svelte';
  import SupporterBadgePicker from '#lib/supporter/SupporterBadgePicker.svelte';
  import type { SupporterAppearance } from '#lib/supporter/variants.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import SettingsRow from '#lib/ui/primitives/SettingsRow.svelte';
  import SettingsSection from '#lib/ui/primitives/SettingsSection.svelte';
  import '#lib/ui/primitives/settings-row.css';
  const core = useCoreClient();
  let name = $derived(core.session?.user_id.split(':', 1)[0]);

  let badge = $derived(supporter.badge);
  let refreshing = $derived(supporter.status === 'refreshing');
  let variantFailed = $state(false);

  async function selectAppearance(patch: Partial<SupporterAppearance>): Promise<void> {
    variantFailed = false;
    try {
      await supporter.selectAppearance(patch);
    } catch {
      variantFailed = true;
    }
  }
</script>

<SettingsSection title={i18n.t('settings.supporterTitle')} headingId="about-supporter">
  <ul class="settings-rows">
    {#if badge}
      <SettingsRow id="supporter-active" title={i18n.t('settings.supporterActive')}>
        <SupporterBadge label={badge.label} {name} isOwnBadge {...supporter.appearance} />
        <Button
          size="small"
          loading={supporter.removing}
          disabled={supporter.savingAppearance || refreshing}
          onclick={() => void supporter.remove()}
        >
          {i18n.t('common.remove')}
        </Button>
      </SettingsRow>
    {/if}
    {#if supporter.status === 'none'}
      <li class="settings-form status" aria-live="polite">{i18n.t('settings.supporterNone')}</li>
    {/if}
    {#if supporter.status === 'failed'}
      <li class="settings-form error" role="alert">{i18n.t('settings.supporterTimedOut')}</li>
    {:else if supporter.status === 'error'}
      <li class="settings-form error" role="alert">{i18n.t('settings.supporterError')}</li>
    {/if}
  </ul>
  {#if badge}
    <SupporterBadgePicker
      value={supporter.appearance}
      {name}
      disabled={supporter.removing}
      onChange={selectAppearance}
    />
    {#if variantFailed}<p class="settings-form error" role="alert">
        {i18n.t('supporter.badgeSaveFailed')}
      </p>{/if}
  {/if}
</SettingsSection>
