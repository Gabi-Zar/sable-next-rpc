<script lang="ts">
  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import SettingsRow from '#lib/ui/primitives/SettingsRow.svelte';
  import StatusBadge from '#lib/ui/primitives/StatusBadge.svelte';
  import '#lib/ui/primitives/settings-row.css';

  const core = useCoreClient();

  const KNOWN = [
    { flag: 'org.matrix.simplified_msc3575', label: 'settings.serverFeatureSlidingSync' },
    { flag: 'org.matrix.msc4140', label: 'settings.callCompatDelayed' },
    { flag: 'org.matrix.msc4354', label: 'settings.callCompatSticky' },
    { flag: 'computer.gingershaped.msc4466', label: 'settings.serverFeatureProfilePropagation' },
  ] as const;

  let features = $state.raw<string[] | null>(null);
  let failed = $state(false);

  $effect(() => {
    let stale = false;
    core.rpc.session
      .serverFeatures()
      .then((flags) => {
        if (!stale) features = flags;
      })
      .catch(() => {
        if (!stale) failed = true;
      });
    return () => {
      stale = true;
    };
  });
</script>

<ul class="settings">
  {#if features}
    {#each KNOWN as known (known.flag)}
      {@const supported = features.includes(known.flag)}
      <SettingsRow id={`server-feature-${known.flag}`} title={$i18n.t(known.label)}>
        <StatusBadge
          label={$i18n.t(supported ? 'settings.callCompatSupported' : 'settings.callCompatMissing')}
          variant={supported ? 'success' : 'warning'}
        />
      </SettingsRow>
    {/each}
  {/if}
  {#if failed}
    <SettingsRow id="server-features-failed" title={$i18n.t('settings.callCompatFailed')} />
  {/if}
</ul>
{#if features?.length}
  <details class="settings-form">
    <summary>{$i18n.t('settings.serverFeaturesAll', { count: features.length })}</summary>
    <ul class="flags">
      {#each features as flag (flag)}
        <li><code>{flag}</code></li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .settings,
  .flags {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .flags {
    display: grid;
    gap: var(--space-100);
  }

  summary {
    cursor: pointer;
  }

  code {
    font-family: var(--font-family-mono);
    overflow-wrap: anywhere;
  }
</style>
