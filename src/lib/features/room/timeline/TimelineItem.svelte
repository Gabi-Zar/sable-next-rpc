<script lang="ts">
  import type { TimelineItemProps } from './timeline-row.svelte';
  import { isAnnotation, isMessageRow } from './timeline-format';
  import TimelineEventRow from './TimelineEventRow.svelte';
  import TimelineMessage from './TimelineMessage.svelte';
  import TimelineNotice from './TimelineNotice.svelte';

  let props: TimelineItemProps = $props();
</script>

{#if props.placeholder || isMessageRow(props.item)}
  <TimelineMessage {...props} />
{:else if isAnnotation(props.item)}
  <TimelineNotice
    item={props.item}
    unreadCount={props.unreadCount ?? 0}
    roomId={props.roomId}
    events={props.events}
    members={props.members}
    currentUserId={props.currentUserId}
    onSenderProfile={props.onSenderProfile}
    onJumpToEvent={props.onJumpToEvent}
  />
{:else}
  <TimelineEventRow {...props} />
{/if}
