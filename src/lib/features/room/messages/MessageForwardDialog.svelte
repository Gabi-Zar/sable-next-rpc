<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import { useRoomList } from '#lib/rooms/room-list.svelte.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import DialogFrame from '#lib/ui/primitives/DialogFrame.svelte';
  import TextInput from '#lib/ui/primitives/TextInput.svelte';
  import RoomChecklist from '../RoomChecklist.svelte';

  interface Props {
    open?: boolean;
    fromRoomId: string;
    onForward: (toRoomIds: string[]) => void;
  }

  let { open = $bindable(false), fromRoomId, onForward }: Props = $props();
  const roomList = useRoomList();
  let search = $state('');
  let selected = $state.raw<string[]>([]);
  const fieldId = $props.id();

  let targets = $derived(
    roomList.rooms
      .filter(
        (room) =>
          room.state === 'joined' && room.room_kind !== 'space' && room.room_id !== fromRoomId
      )
      .filter((room) =>
        (room.name ?? room.room_id).toLowerCase().includes(search.trim().toLowerCase())
      )
  );

  function send(): void {
    if (selected.length === 0) return;
    const rooms = selected;
    open = false;
    search = '';
    selected = [];
    onForward(rooms);
  }

  function cancel(): void {
    open = false;
    search = '';
    selected = [];
  }
</script>

<DialogFrame bind:open variant="verification" label={i18n.t('timeline.forwardTitle')}>
  <div class="forward">
    <h2>{i18n.t('timeline.forwardTitle')}</h2>
    <TextInput
      id={fieldId}
      bind:value={search}
      placeholder={i18n.t('common.searchRooms')}
      aria-label={i18n.t('common.searchRooms')}
    />
    {#if targets.length === 0}
      <p class="empty">{i18n.t('common.noRoomsMatchThatSearch')}</p>
    {:else}
      <RoomChecklist
        class="targets"
        rooms={targets}
        bind:selected
        label={(room) => room.name ?? room.room_id}
      />
    {/if}

    <div class="actions">
      <span class="count" aria-live="polite">
        {selected.length === 0
          ? ''
          : i18n.t('timeline.forwardSelected', { count: selected.length })}
      </span>
      <Button variant="ghost" onclick={cancel}>{i18n.t('common.cancel')}</Button>
      <Button disabled={selected.length === 0} onclick={send}>
        {i18n.t('timeline.forwardSend')}
      </Button>
    </div>
  </div>
</DialogFrame>

<style>
  .forward {
    display: grid;
    gap: var(--space-300);
    width: min(24rem, calc(100vw - 2rem));
  }

  h2 {
    font-size: var(--font-size-heading);
    line-height: var(--line-height-heading);
    margin: 0;
  }

  .empty {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    margin: 0;
  }

  .actions {
    align-items: center;
    display: flex;
    gap: var(--space-200);
    justify-content: flex-end;
  }

  .count {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    margin-right: auto;
  }
</style>
