<script lang="ts">
  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import CallModeDebug from '#lib/features/call/CallModeDebug.svelte';
  import { callDebug } from '#lib/features/call/call-debug.svelte.js';
  import SettingsRow from '#lib/ui/primitives/SettingsRow.svelte';
  import StatusBadge from '#lib/ui/primitives/StatusBadge.svelte';
  import '#lib/ui/primitives/settings-row.css';

  import type { CallCompatibilityView } from '#src/generated/protocol';

  const core = useCoreClient();

  const TRANSPORT_LABELS = {
    endpoint: 'settings.callCompatTransportEndpoint',
    well_known: 'settings.callCompatTransportWellKnown',
    none: 'settings.callCompatMissing',
  } as const;

  let compatibility = $state.raw<CallCompatibilityView | null>(null);
  let failed = $state(false);

  $effect(() => {
    let stale = false;
    core.rpc.calls
      .compatibility()
      .then((view) => {
        if (!stale) compatibility = view;
      })
      .catch(() => {
        if (!stale) failed = true;
      });
    return () => {
      stale = true;
    };
  });

  const rows = $derived<{ id: string; label: string; value: boolean }[]>(
    compatibility
      ? [
          {
            id: 'call-compat-sticky',
            label: 'settings.callCompatSticky',
            value: compatibility.sticky_events,
          },
          {
            id: 'call-compat-delayed',
            label: 'settings.callCompatDelayed',
            value: compatibility.delayed_events,
          },
        ]
      : []
  );
</script>

<ul class="settings">
  {#each rows as row (row.id)}
    <SettingsRow id={row.id} title={$i18n.t(row.label)}>
      <StatusBadge
        label={$i18n.t(row.value ? 'settings.callCompatSupported' : 'settings.callCompatMissing')}
        variant={row.value ? 'success' : 'warning'}
      />
    </SettingsRow>
  {/each}
  {#if compatibility}
    <SettingsRow id="call-compat-transports" title={$i18n.t('settings.callCompatTransports')}>
      <StatusBadge
        label={$i18n.t(TRANSPORT_LABELS[compatibility.rtc_transports])}
        variant={compatibility.rtc_transports === 'none' ? 'warning' : 'success'}
      />
    </SettingsRow>
  {/if}
  {#if failed}
    <SettingsRow id="call-compat-failed" title={$i18n.t('settings.callCompatFailed')} />
  {/if}
</ul>
{#if callDebug.current}
  <div class="settings-form">
    <p class="last">{$i18n.t('settings.callCompatLast')}</p>
    <CallModeDebug />
  </div>
{/if}

<style>
  .settings {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .last {
    margin: 0;
    opacity: var(--opacity-secondary);
  }
</style>
