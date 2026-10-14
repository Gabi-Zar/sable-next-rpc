<script lang="ts">
  import type { MemberView, SendStateView } from '#src/generated/protocol';

  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import Tooltip from '#lib/ui/primitives/Tooltip.svelte';
  import { toasts } from '#lib/ui/toasts.svelte.js';
  import { memberIdentity } from '../members/members.js';

  interface Props {
    failure: Extract<SendStateView, { status: 'failed' }>;
    transactionId: string | null;
    members: readonly MemberView[];
    onRetrySend?: (transactionId: string) => void;
    onCancelSend?: (transactionId: string) => void;
  }

  let { failure, transactionId, members, onRetrySend, onCancelSend }: Props = $props();

  const core = useCoreClient();
  let blocked = $derived(failure.blocked);
  let changedNames = $derived(
    blocked?.kind === 'identity_changed'
      ? blocked.user_ids.map((userId) => memberIdentity(members, userId).name).join(', ')
      : ''
  );

  async function sendAnyway(transactionId: string, userIds: readonly string[]): Promise<void> {
    try {
      for (const userId of userIds)
        await core.rpc.encryption.withdrawVerification({ user_id: userId });
      onRetrySend?.(transactionId);
    } catch (error) {
      console.warn('[sable timeline] could not withdraw the verification', error);
      toasts.error(i18n.t('errors.actionFailed'));
    }
  }
</script>

<p class="send-failure">
  <Tooltip label={failure.error} multiline>
    {#snippet trigger({ props })}
      <span {...props}>{i18n.t('timeline.sendFailed')}</span>
    {/snippet}
  </Tooltip>
  {#if transactionId && blocked?.kind === 'identity_changed'}
    {@const id = transactionId}
    {@const userIds = blocked.user_ids}
    <button
      type="button"
      onclick={() => {
        void sendAnyway(id, userIds);
      }}
    >
      {i18n.t('timeline.sendAnyway')}
    </button>
  {/if}
  {#if transactionId}
    {@const id = transactionId}
    <button
      type="button"
      onclick={() => {
        onRetrySend?.(id);
      }}
    >
      {i18n.t('common.retry')}
    </button>
    <button
      type="button"
      onclick={() => {
        onCancelSend?.(id);
      }}
    >
      {i18n.t('common.delete')}
    </button>
  {/if}
  <span class="send-failure-reason">
    {#if blocked?.kind === 'identity_changed'}
      {i18n.t('timeline.sendBlockedIdentity', { names: changedNames })}
    {:else if blocked?.kind === 'verify_this_device'}
      {i18n.t('timeline.sendBlockedVerify')}
    {:else}
      {failure.error}
    {/if}
  </span>
</p>

<style>
  .send-failure {
    align-items: baseline;
    color: var(--crit-main);
    display: flex;
    flex-wrap: wrap;
    font-size: var(--font-size-small);
    gap: var(--space-050) var(--space-200);
    margin-top: var(--space-050);
  }

  .send-failure-reason {
    color: var(--surface-var-on-container);
    flex-basis: 100%;
    overflow-wrap: anywhere;
  }

  .send-failure button {
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0;
    position: relative;
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  /* Small text buttons, so the tap area is grown without moving the baseline. */
  .send-failure button::after {
    content: '';
    inset: -0.5rem -0.25rem;
    position: absolute;
  }

  .send-failure button:focus-visible {
    border-radius: var(--radii-200);
    outline: var(--focus-ring-width) solid var(--focus-ring);
    outline-offset: 0.15rem;
  }
</style>
