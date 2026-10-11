<script lang="ts">
  import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';

  import type { RoomSummary } from '#src/generated/protocol';

  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import { roomSectionPath } from '#lib/rooms/permalink.js';
  import { useRoomList } from '#lib/rooms/room-list.svelte.js';
  import Avatar from '#lib/ui/primitives/Avatar.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import Tooltip from '#lib/ui/primitives/Tooltip.svelte';
  import { toasts } from '#lib/ui/toasts.svelte.js';

  import {
    dismissReplacedRoom,
    isReplacedRoomDismissed,
  } from './dismissed-replaced-rooms.svelte.js';

  interface Props {
    collapsed?: boolean;
  }

  let { collapsed = false }: Props = $props();
  const core = useCoreClient();
  const roomList = useRoomList();
  const headingId = $props.id();

  let replaced = $derived(
    roomList.rooms.filter((room) => room.state === 'joined' && room.is_tombstoned)
  );
  let pendingCount = $derived(
    replaced.filter((room) => !isReplacedRoomDismissed(room.room_id)).length
  );

  async function leave(room: RoomSummary): Promise<void> {
    try {
      await core.commands.leaveRoom(room.room_id);
    } catch {
      toasts.error($i18n.t('room.leaveFailed'));
    }
  }
</script>

{#if replaced.length > 0 && collapsed}
  <ul class="replaced-collapsed" aria-label={$i18n.t('room.replacedTitle')}>
    {#each replaced as room (room.room_id)}
      {@const name = room.name ?? room.room_id}
      <li aria-label={name}>
        <Tooltip label={name}>
          {#snippet trigger({ props })}
            <a {...props} href={roomSectionPath(roomList.rooms, room.room_id)} draggable="false">
              <Avatar class="replaced-icon" id={room.room_id} src={room.avatar_url} {name} />
            </a>
          {/snippet}
        </Tooltip>
      </li>
    {/each}
  </ul>
{:else if replaced.length > 0}
  <section class="replaced" aria-labelledby={headingId}>
    <h3 id={headingId}>
      {$i18n.t('room.replacedTitle')}
      {#if pendingCount > 0}<span class="count">{pendingCount}</span>{/if}
    </h3>
    <ul>
      {#each replaced as room (room.room_id)}
        {@const name = room.name ?? room.room_id}
        {@const handled = isReplacedRoomDismissed(room.room_id)}
        <li class:handled>
          <a
            class="replaced-link"
            href={roomSectionPath(roomList.rooms, room.room_id)}
            draggable="false"
          >
            <Avatar
              class="replaced-icon"
              size="small"
              id={room.room_id}
              src={room.avatar_url}
              {name}
            />
            <Tooltip label={name}>
              {#snippet trigger({ props })}
                <span {...props} class="replaced-name">{name}</span>
              {/snippet}
            </Tooltip>
          </a>
          <Tooltip label={$i18n.t('room.replacedLeaveLabel', { room: name })}>
            {#snippet trigger({ props })}
              <IconButton
                {...props}
                variant="ghost"
                size="small"
                label={$i18n.t('room.replacedLeaveLabel', { room: name })}
                onclick={() => {
                  void leave(room);
                }}
              >
                <SignOutIcon />
              </IconButton>
            {/snippet}
          </Tooltip>
          {#if !handled}
            <Tooltip label={$i18n.t('room.replacedDismissLabel', { room: name })}>
              {#snippet trigger({ props })}
                <IconButton
                  {...props}
                  variant="ghost"
                  size="small"
                  label={$i18n.t('room.replacedDismissLabel', { room: name })}
                  onclick={() => {
                    dismissReplacedRoom(room.room_id);
                  }}
                >
                  <XIcon />
                </IconButton>
              {/snippet}
            </Tooltip>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .replaced {
    padding: 0 var(--space-200) var(--space-200);
  }

  h3 {
    align-items: center;
    color: var(--bg-on-container);
    display: flex;
    font-size: var(--font-size-label);
    font-weight: var(--font-weight-500);
    gap: var(--space-200);
    margin: 0;
    opacity: var(--opacity-p300);
    padding: 0 var(--space-200);
  }

  .count {
    align-items: center;
    background: var(--sec-main);
    border-radius: var(--radii-pill);
    box-sizing: border-box;
    color: var(--sec-on-main);
    display: inline-flex;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-weight-medium);
    height: var(--size-x50);
    justify-content: center;
    line-height: var(--size-x50);
    min-width: var(--size-x50);
    padding: 0 var(--space-100);
  }

  ul {
    display: grid;
    gap: var(--space-100);
    list-style: none;
    margin: var(--space-100) 0 0;
    padding: 0;
  }

  li {
    align-items: center;
    border-radius: var(--radius);
    display: flex;
    gap: var(--space-200);
    min-height: var(--control-height-medium);
    min-width: 0;
    padding: 0 var(--space-100) 0 var(--space-200);
  }

  li.handled {
    opacity: 0.7;
  }

  li:hover {
    background: var(--bg-container-hover);
  }

  li :global(.icon-button:hover) {
    background: var(--surface-container-hover);
    color: var(--surface-on-container);
  }

  .replaced-collapsed {
    display: grid;
    gap: var(--space-100);
    justify-items: center;
    list-style: none;
    margin: 0;
    padding: 0 0 var(--space-200);
  }

  .replaced-collapsed li {
    padding: 0;
  }

  :global(.avatar-root.replaced-icon) {
    --avatar-size: 1.5rem;

    font-size: var(--font-size-small);
  }

  .replaced-link {
    align-items: center;
    color: inherit;
    display: flex;
    flex: 1;
    gap: var(--space-200);
    min-width: 0;
    text-decoration: none;
  }

  .replaced-name {
    flex: 1;
    font-weight: var(--font-weight-500);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
