<script lang="ts">
  import { copyText } from '#lib/platform/clipboard.js';
  import { onDestroy, type Snippet } from 'svelte';

  import type {
    MemberView,
    PerMessageProfileView,
    ReplyView,
    TimelineItemView,
  } from '#src/generated/protocol';

  import { useCoreClient } from '#lib/core/context.js';
  import '../members/avatar-button.css';
  import { profileOverrides } from '#lib/profile/profile-overrides.svelte.js';
  import { cursorAnchor, type CursorAnchor } from '#lib/ui/cursor-anchor.js';
  import { LongPress, touchContextMenu } from '#lib/ui/long-press.svelte.js';
  import { DoubleTap } from '#lib/ui/double-tap.js';
  import { hapticFeedback } from '#lib/platform/haptics.js';
  import { mediaProgress } from '#lib/ui/media-progress.svelte.js';
  import { findMember, personaWithColor, senderDisplayColors } from '../members/members.js';
  import { previewableLinks } from '../media/link-preview.js';
  import LinkEmbed from '../media/embeds/LinkEmbed.svelte';
  import { MessageSwipe } from '../messages/message-swipe.svelte.js';
  import { i18n } from '#lib/i18n.js';
  import { splitDisplayNamePronouns, withDisplayNamePronouns } from '#lib/personas/pronouns.js';
  import { usePersonaStore } from '#lib/personas/personas.svelte.js';
  import { preferences, type TimelineLayout } from '#lib/settings/preferences.svelte.js';
  import Avatar from '#lib/ui/primitives/Avatar.svelte';
  import Skeleton from '#lib/ui/primitives/Skeleton.svelte';
  import Tooltip from '#lib/ui/primitives/Tooltip.svelte';
  import { nameColorOnDark, nameColorOnLight } from '#lib/ui/primitives/readable-color.js';

  import FormattedBody from '../messages/FormattedBody.svelte';
  import MessageBody from '../messages/MessageBody.svelte';
  import MessageReactions from '../messages/MessageReactions.svelte';
  import { usePinnedEvents } from './pinned-events.svelte.js';
  import TimelineNotice from './TimelineNotice.svelte';
  import type { TimelineEventIndex } from './timeline-event-index';
  import MessageActions from '../messages/MessageActions.svelte';

  import { useBookmarks } from '#lib/rooms/bookmarks.svelte.js';
  import { useMessageMenu } from '../messages/message-menu-open.svelte.js';
  import '#lib/ui/primitives/menu.css';
  import ReadReceiptStack from './ReadReceiptStack.svelte';
  import { receiptReserve } from './receipt-reserve';
  import SenderName from '../members/SenderName.svelte';
  import RoleTagIcon from '../members/RoleTagIcon.svelte';
  import { hasSenderRoles, useSenderRoles } from '../members/sender-roles.js';
  import { useRoomCosmetics, type SenderCosmetics } from '#lib/rooms/room-cosmetics.svelte.js';
  import ForwardedLine from '../messages/ForwardedLine.svelte';
  import type { MatrixLink } from '#lib/rooms/matrix-link.js';
  import { useMessageDialogs } from '../messages/message-dialogs.svelte.js';
  import '../members/sender-identity.css';
  import { formatFullTimestamp, formatMessageTimestamp, formatTime } from '#lib/ui/date-time.js';
  import Spinner from '#lib/ui/primitives/Spinner.svelte';
  import { isAnnotation, isMessageRow } from './timeline-format';

  import { MessageActionExecutor } from '../messages/message-action-controller.svelte.js';
  import { TimelineItemProfiles } from './timeline-item-profiles.svelte';
  import { TimelineItemEngagement } from './timeline-item-engagement.svelte';
  import { selectedText, withSelectedText } from './timeline-item-selection';
  import TimelineReplyPreview from './TimelineReplyPreview.svelte';
  import TimelineSendFailure from './TimelineSendFailure.svelte';
  import TimelineSwipeAction from './TimelineSwipeAction.svelte';
  import TimelineThreadSummary from './TimelineThreadSummary.svelte';
  import TimelineTransfer from './TimelineTransfer.svelte';

  import type { MessageCallbacks } from '../messages/message-action-controller.svelte.js';

  interface Props extends MessageCallbacks {
    item: TimelineItemView;
    collapsed: boolean;
    unreadCount?: number;
    replyPersona?: PerMessageProfileView | null;
    threadPersona?: PerMessageProfileView | null;
    roomId?: string;
    highlighted?: boolean;
    onMatrixLink?: (link: MatrixLink, anchor: HTMLAnchorElement) => void;
    onSenderProfile?: (
      userId: string,
      anchor: HTMLElement,
      pmp?: PerMessageProfileView | null
    ) => void;
    onMentionUser?: (userId: string, name: string) => void;
    onRetrySend?: (transactionId: string) => void;
    onCancelSend?: (transactionId: string) => void;
    currentUserId?: string | null;
    canRedactOwn?: boolean;
    canRedactOthers?: boolean;
    canPin?: boolean;
    encrypted?: boolean | null;
    selected?: boolean;
    editing?: boolean;
    editor?: Snippet;
    layout?: TimelineLayout;
    preview?: boolean;
    loadPreviewProfile?: boolean;
    timeAction?: { label: string; run: () => void };
    headerAction?: Snippet;
    alignOwn?: boolean;
    avatarsInHeaders?: boolean;
    members?: readonly MemberView[];
    onJumpToEvent?: (eventId: string) => void;
    onOpenMedia?: (eventId: string) => void;
    onVotePoll?: (eventId: string, answers: string[]) => void;
    onEndPoll?: (eventId: string) => void;
    events?: TimelineEventIndex;
    onMenuOpenChange?: (open: boolean) => void;
    placeholder?: boolean;
    placeholderCharacters?: number;
    overrideCosmetics?: SenderCosmetics | null;
  }

  let {
    item,
    collapsed,
    unreadCount = 0,
    replyPersona = null,
    threadPersona = null,
    roomId = '',
    highlighted = false,
    onMatrixLink,
    onSenderProfile,
    onMentionUser,
    onRetrySend,
    onCancelSend,
    currentUserId = null,
    onToggleReaction,
    onReply,
    onCancelContext,
    onOpenThread,
    onEdit,
    onDelete,
    onCopyLink,
    onMarkUnread,
    canRedactOwn = true,
    canRedactOthers = false,
    canPin = true,
    encrypted = null,
    selected = false,
    editing = false,
    editor,
    layout = 'modern',
    preview = false,
    loadPreviewProfile = false,
    timeAction,
    headerAction,
    alignOwn = true,
    avatarsInHeaders = true,
    members = [],
    onJumpToEvent,
    onOpenMedia,
    onVotePoll,
    onEndPoll,
    events,
    onMenuOpenChange,
    placeholder = false,
    placeholderCharacters = 35,
    overrideCosmetics = null,
  }: Props = $props();

  let defaultEmoteSize = $derived(preferences.timelineEmoteSize === 'default');
  let timelineEmoteSize = $derived(defaultEmoteSize ? '1lh' : `${preferences.timelineEmoteSize}px`);
  const core = useCoreClient();
  const personaStore = usePersonaStore();
  const bookmarks = useBookmarks();
  const pinnedEvents = usePinnedEvents();
  const roomCosmetics = useRoomCosmetics();
  const senderRoles = hasSenderRoles() ? useSenderRoles() : null;
  const dialogs = useMessageDialogs();
  const openMessageMenu = useMessageMenu();
  const itemProfiles = new TimelineItemProfiles(core);
  let profile = $derived(itemProfiles.sender);
  let senderCosmetics = $derived(overrideCosmetics ?? roomCosmetics?.for(item.sender) ?? null);
  let senderTimezone = $derived(profile?.timezone ?? null);
  let senderMember = $derived(findMember(members, item.sender));
  let roomIdentity = $derived({
    name: senderMember ? senderMember.display_name : item.sender_name,
    avatar: senderMember ? senderMember.avatar_url : item.sender_avatar,
  });
  let accountName = $derived(
    profileOverrides.name(
      item.sender ?? '',
      roomIdentity.name ??
        (senderMember ? null : profile?.display_name) ??
        item.sender ??
        i18n.t('timeline.unknownSender')
    )
  );
  let persona = $derived(item.per_message_profile);
  let senderIdentity = $derived(
    preferences.showPronouns && preferences.showPronounPills
      ? splitDisplayNamePronouns(persona?.display_name ?? accountName)
      : { name: persona?.display_name ?? accountName, pronouns: [] }
  );
  let senderName = $derived(senderIdentity.name);
  let emoteName = $derived(splitDisplayNamePronouns(senderName).name);
  let senderAvatar = $derived(
    persona?.avatar_url === ''
      ? null
      : (persona?.avatar_url ?? profileOverrides.avatar(item.sender ?? '', roomIdentity.avatar))
  );
  let personaTint = $derived(personaWithColor(persona));
  let pronouns = $derived(
    preferences.showPronouns && preferences.showPronounPills
      ? withDisplayNamePronouns(
          persona?.pronouns?.length
            ? persona.pronouns
            : senderCosmetics?.pronouns.length
              ? senderCosmetics.pronouns
              : (profile?.pronouns ?? []),
          senderIdentity.pronouns
        )
      : []
  );
  let replyTarget = $derived(
    item.in_reply_to ? (events?.get(item.in_reply_to.event_id) ?? null) : null
  );
  let replySender = $derived(item.in_reply_to?.sender ?? replyTarget?.sender ?? null);
  let emote = $derived(item.content.kind === 'message' && item.content.emote);
  let notice = $derived(item.content.kind === 'message' && item.content.notice);
  let jumbo = $derived(item.content.kind === 'message' ? (item.content.jumbo ?? null) : null);
  let stalled = $derived(item.send_state?.status === 'failed' ? item.send_state : null);
  let pending = $derived(item.send_state?.status === 'sending');
  let upload = $derived(
    item.send_state?.status === 'sending' ? (item.send_state.progress ?? null) : null
  );
  let uploading = $derived(
    pending &&
      (item.content.kind === 'image' ||
        item.content.kind === 'video' ||
        item.content.kind === 'audio' ||
        item.content.kind === 'file' ||
        item.content.kind === 'gallery')
  );
  let galleryCount = $derived(item.content.kind === 'gallery' ? item.content.items.length : 0);
  let uploadFraction = $derived.by(() => {
    if (upload === null) return null;
    const part = upload.total > 0 ? Math.min(1, upload.current / upload.total) : 0;
    return galleryCount > 1 ? Math.min(1, (upload.index + part) / galleryCount) : part;
  });
  let uploadItem = $derived(
    upload !== null && galleryCount > 1 ? Math.min(upload.index + 1, galleryCount) : null
  );
  const saving = mediaProgress(core, () => actionExecutor.savingSource);

  let actionable = $derived(!preview && item.event_id !== null && stalled === null && !pending);
  let editable = $derived(
    item.is_own && (item.content.kind === 'message' || item.content.kind === 'image')
  );
  const swipe = new MessageSwipe({
    enabled: () => actionable && actions.onReply !== undefined,
    canEdit: () => actionable && actions.onEdit !== undefined,
    onReply: () => (selected ? onCancelContext?.() : actions.onReply?.()),
    onEdit: () => (editing ? onCancelContext?.() : actions.onEdit?.()),
  });
  let senderRole = $derived(item.sender ? (senderRoles?.(item.sender) ?? null) : null);
  let senderColors = $derived(
    senderDisplayColors(
      item.sender ?? '',
      profile,
      persona,
      item.is_own,
      senderCosmetics,
      senderRole?.color ?? null
    )
  );
  let senderRoleIcon = $derived(senderRole?.icon ?? null);

  $effect(() => {
    itemProfiles.sync(item.sender, replySender, preview && !loadPreviewProfile);
  });

  onDestroy(() => itemProfiles.dispose());

  const actionExecutor = new MessageActionExecutor(
    () => ({
      item,
      roomId,
      canPin,
      canRedactOwn,
      canRedactOthers,
      senderTimezone,
      anchor: emoteAnchor ?? messageRow,
      hasLinkPreviews: bundledPreviews.length > 0 || previewUrls.length > 0,
      onToggleReaction,
      onMarkUnread,
      onReply,
      onEdit,
      onDelete,
      onOpenThread,
      onCopyLink,
    }),
    { core, personaStore, pinnedEvents, bookmarks, dialogs }
  );
  let actions = $derived(actionExecutor.actions);

  let emoteAnchor = $state.raw<CursorAnchor | null>(null);
  let threadTarget = $derived(item.thread_root ?? item.event_id);
  let threadSummary = $derived(item.thread_summary);
  let messageRow = $state<HTMLElement | null>(null);
  let receiptReaders = $derived(item.read_by.filter((readerId) => readerId !== currentUserId));
  let showReceiptBadge = $derived(
    !preferences.hideReadReceipts &&
      preferences.readReceiptPlacement === 'message' &&
      receiptReaders.length > 0
  );
  let nonTextContent = $derived(item.content.kind !== 'message');
  let previewsRemoved = $derived(item.link_previews_removed === true);
  let bundledPreviews = $derived(previewsRemoved ? [] : item.bundled_link_previews);
  let previewUrls = $derived(
    item.content.kind === 'message' && !previewsRemoved
      ? previewableLinks(item.content.html, item.content.body)
      : []
  );
  let receiptWidth = $state(0);
  let receiptsInline = $derived(
    (!nonTextContent || item.content.kind === 'redacted') &&
      item.reactions.length === 0 &&
      !threadSummary &&
      !item.thread_root &&
      bundledPreviews.length === 0 &&
      previewUrls.length === 0 &&
      upload === null &&
      stalled === null
  );

  let receiptsVisible = $derived(showReceiptBadge && (actionable || preview));
  let trailingReceiptBadge = $derived(receiptsVisible && !receiptsInline);

  const rowPress = new LongPress({
    enabled: () => actionable,
    onPress: () => {
      openMessageMenu.set(item.id, false);
      const selected = selectedText(messageRow);
      dialogs.open(item, { kind: 'sheet', actions: () => withSelectedText(actions, selected) });
    },
  });

  const rowDoubleTap = new DoubleTap(() => {
    if (!actionable || !preferences.doubleTapReact || !actions.onReact) return;
    hapticFeedback();
    actions.onReact(preferences.doubleTapReaction);
  });

  function rowPointerDown(event: PointerEvent): void {
    rowPress.start(event);
    rowDoubleTap.down(event);
    if (event.pointerType === 'mouse') engagement.hold();
  }

  function rowPointerUp(event: PointerEvent): void {
    rowPress.end(event);
    rowDoubleTap.up(event);
  }

  function rowPointerCancel(event: PointerEvent): void {
    rowPress.end(event);
    rowDoubleTap.cancel();
  }

  const engagement = new TimelineItemEngagement(() => messageRow);
  let actionsPinned = $state(false);

  function pinActions(open: boolean): void {
    if (open) emoteAnchor = null;
    actionsPinned = open;
    onMenuOpenChange?.(open);
  }

  function openContextMenu(event: MouseEvent): void {
    if (rowPress.touch || touchContextMenu(event)) {
      event.preventDefault();
      if (actionable && !rowPress.pending && !dialogs.isOpen(item, 'sheet')) rowPress.fire(event);
      return;
    }
    if (!actionable) return;
    event.preventDefault();
    emoteAnchor = cursorAnchor(event);
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href]')?.href
        : null;
    const selected = selectedText(messageRow);
    openMessageMenu.open(item.id, { x: event.clientX, y: event.clientY }, () => ({
      ...withSelectedText(actions, selected),
      onCopyHref: link ? () => void copyText(link) : undefined,
    }));
  }

  // A virtualised row can unmount mid-press, so the pending timer has to go.
  onDestroy(() => {
    rowPress.cancel();
  });

  function cancelUpload(): void {
    if (item.transaction_id) onCancelSend?.(item.transaction_id);
  }

  function openSenderProfileAt(anchor: HTMLElement): void {
    if (item.sender) onSenderProfile?.(item.sender, anchor, persona);
  }

  function openSenderProfile(event: MouseEvent & { currentTarget: HTMLButtonElement }): void {
    openSenderProfileAt(event.currentTarget);
  }

  function openSenderAccountProfileAt(anchor: HTMLElement): void {
    if (item.sender) onSenderProfile?.(item.sender, anchor);
  }

  let nameOpensProfile = $derived(
    (preferences.usernameClick === 'profile' || onMentionUser === undefined) &&
      onSenderProfile !== undefined &&
      item.sender !== null
  );
  let nameMentions = $derived(
    !nameOpensProfile && onMentionUser !== undefined && item.sender !== null
  );

  function mentionSender(): void {
    if (item.sender) onMentionUser?.(item.sender, accountName);
  }
</script>

{#snippet receiptSlot()}
  <span class="receipt-slot" bind:clientWidth={receiptWidth}>
    <ReadReceiptStack
      readers={receiptReaders}
      timestamps={item.read_timestamps}
      {members}
      expanded={dialogs.isOpen(item, 'receipts')}
      onProfile={onSenderProfile}
      onOpen={() => {
        dialogs.open(item, { kind: 'receipts' });
      }}
    />
  </span>
{/snippet}

{#snippet actionLayer()}
  {#if actionable && (engagement.engaged || actionsPinned)}
    <MessageActions
      onPickerOpenChange={pinActions}
      onOverflowOpenChange={pinActions}
      {...actions}
    />
  {/if}
{/snippet}

{#snippet replyPreview(reply: ReplyView)}
  <TimelineReplyPreview
    {reply}
    target={replyTarget}
    sender={replySender}
    persona={replyPersona}
    profile={itemProfiles.reply}
    {currentUserId}
    {members}
    {onJumpToEvent}
  />
{/snippet}

{#snippet senderAvatarButton(size: 'tiny' | 'small')}
  {#if item.sender && onSenderProfile}
    <button
      class="avatar-button"
      type="button"
      aria-label={i18n.t('timeline.senderProfile', { name: senderName })}
      onclick={openSenderProfile}
    >
      <Avatar
        class="message-avatar"
        src={senderAvatar}
        {size}
        id={personaTint ? null : item.sender}
        name={senderName}
      />
    </button>
  {:else}
    <Avatar
      class="message-avatar"
      src={senderAvatar}
      {size}
      id={personaTint ? null : item.sender}
      name={senderName}
    />
  {/if}
{/snippet}

{#snippet messageTime()}
  {#if pending}
    <Spinner small label={i18n.t('timeline.sending')} />
  {:else}
    {@const fullTimestamp = formatFullTimestamp(item.timestamp)}
    <Tooltip label={fullTimestamp}>
      {#snippet trigger({ props })}
        <time {...props} datetime={new Date(item.timestamp).toISOString()}>
          {formatMessageTimestamp(item.timestamp)}
        </time>
      {/snippet}
    </Tooltip>
  {/if}
{/snippet}

{#if placeholder}
  <article
    class={['message', 'placeholder-message', `layout-${layout}`, { collapsed }]}
    aria-hidden="true"
  >
    {#if layout === 'compact'}
      <div class="compact-gutter">
        <time><Skeleton class="placeholder-time" /></time>
        <Skeleton class="compact-name placeholder-name" />
      </div>
    {:else if !collapsed}
      <Skeleton class="avatar-root avatar-small message-avatar placeholder-avatar" />
    {/if}
    <div class="message-content">
      {#if !collapsed && layout !== 'compact'}
        <header>
          <Skeleton class="sender placeholder-name" />
          <div class="message-details">
            <time><Skeleton class="placeholder-time" /></time>
          </div>
        </header>
      {/if}
      {#if placeholderCharacters > 0}
        <div class="formatted-body placeholder-body">
          <span class="placeholder-copy">{'x'.repeat(placeholderCharacters)}</span>
        </div>
      {/if}
    </div>
  </article>
{:else if isMessageRow(item)}
  <article
    bind:this={messageRow}
    class={[
      'message',
      `layout-${layout}`,
      {
        collapsed,
        highlighted,
        pressed: rowPress.pressing,
        'has-connected-reply':
          item.in_reply_to !== null && preferences.replyPreviewStyle === 'connected',
        persona: personaTint,
        own: item.is_own,
        'align-own': alignOwn,
        'mention-silent': preferences.highlightMentions && item.mention === 'silent',
        'mention-loud': preferences.highlightMentions && item.mention === 'loud',
        'menu-open': actionsPinned || openMessageMenu.isOpen(item.id),
      },
    ]}
    data-selected={selected ? 'true' : undefined}
    style:--pmp-on-light={nameColorOnLight(personaTint?.color_on_light) ?? undefined}
    style:--pmp-on-dark={nameColorOnDark(personaTint?.color_on_dark) ?? undefined}
    style:--sender-name-color={senderColors.nameColor}
    style:--name-color-on-light={senderColors.nameColorLight ?? undefined}
    style:--name-color-on-dark={senderColors.nameColorDark ?? undefined}
    style:--timeline-emote-size={timelineEmoteSize}
    style:--timeline-emote-align={defaultEmoteSize ? 'bottom' : undefined}
    style:transform={swipe.offset === 0 ? undefined : `translateX(${String(-swipe.offset)}px)`}
    style:transition={swipe.dragging ? 'none' : undefined}
    onpointerdown={rowPointerDown}
    onpointermove={rowPress.move}
    onpointerup={rowPointerUp}
    onpointercancel={rowPointerCancel}
    onpointerenter={engagement.engage}
    onpointerleave={engagement.disengage}
    onfocusin={engagement.engage}
    onfocusout={engagement.disengage}
    oncontextmenu={openContextMenu}
    {@attach swipe.attach}
  >
    {#if swipe.offset > 0}
      <TimelineSwipeAction
        offset={swipe.offset}
        armed={swipe.action !== 'none'}
        edit={swipe.action === 'edit'}
      />
    {/if}
    {@render actionLayer()}
    {#if !actionable && editable && item.transaction_id && engagement.engaged}
      <MessageActions {roomId} onEdit={actions.onEdit} />
    {/if}
    {#if layout !== 'compact' && !collapsed}
      {@render senderAvatarButton('small')}
    {/if}
    <div
      class="message-content"
      style:--receipt-reserve={trailingReceiptBadge ? `${String(receiptWidth)}px` : undefined}
    >
      {#if layout === 'compact'}
        {@const fullTimestamp = formatFullTimestamp(item.timestamp)}
        <div class="compact-gutter">
          {#if pending}
            <Spinner small label={i18n.t('timeline.sending')} />
          {:else}
            <Tooltip label={fullTimestamp}>
              {#snippet trigger({ props })}
                <time {...props} datetime={new Date(item.timestamp).toISOString()}>
                  {formatTime(item.timestamp)}
                </time>
              {/snippet}
            </Tooltip>
          {/if}
          <div class="compact-user">
            {#if avatarsInHeaders}
              {@render senderAvatarButton('tiny')}
            {/if}
            <SenderName
              displayName={senderName}
              colors={senderColors}
              {pronouns}
              nameClass="compact-name"
              onMention={nameMentions ? mentionSender : undefined}
              onProfile={nameOpensProfile ? openSenderProfileAt : undefined}
              compact={layout === 'compact'}
            />
          </div>
        </div>
      {/if}
      {#if item.in_reply_to && (preferences.replyPreviewStyle === 'connected' || layout === 'compact')}
        {@render replyPreview(item.in_reply_to)}
      {/if}
      {#if !collapsed && layout !== 'compact'}
        <header>
          {#if !emote}
            <SenderName
              displayName={senderName}
              accountName={persona ? accountName : undefined}
              colors={senderColors}
              {pronouns}
              onMention={nameMentions ? mentionSender : undefined}
              onProfile={nameOpensProfile ? openSenderProfileAt : undefined}
              onViaProfile={openSenderAccountProfileAt}
            />
            {#if senderRoleIcon}
              {#if preferences.showRoleTooltip && senderRole?.name}
                <Tooltip label={senderRole.name}>
                  {#snippet trigger({ props })}
                    <span {...props} class="sender-role"><RoleTagIcon icon={senderRoleIcon} /></span
                    >
                  {/snippet}
                </Tooltip>
              {:else}
                <RoleTagIcon icon={senderRoleIcon} />
              {/if}
            {/if}
          {/if}
          <div class="message-details">
            {#if item.sender}
              <button
                class="via via-hidden"
                type="button"
                aria-label={i18n.t('timeline.senderProfile', { name: item.sender })}
                onclick={openSenderProfile}>{item.sender}</button
              >
            {/if}
            {#if timeAction}
              <button
                class="message-time-action"
                type="button"
                aria-label={timeAction.label}
                onclick={timeAction.run}
              >
                {@render messageTime()}
              </button>
            {:else}
              {@render messageTime()}
            {/if}
            {@render headerAction?.()}
          </div>
        </header>
      {/if}
      <div class="message-main">
        {#if item.in_reply_to && preferences.replyPreviewStyle !== 'connected' && layout !== 'compact'}
          {@render replyPreview(item.in_reply_to)}
        {/if}
        {#if item.forwarded}
          <div>
            <ForwardedLine forwarded={item.forwarded} {roomId} {onJumpToEvent} />
          </div>
        {/if}
        {#if item.content.kind === 'message' && item.content.emote}
          {@const inlineReceipts = receiptsVisible && receiptsInline}
          <div
            class={['emote', { 'has-receipts': inlineReceipts }]}
            style:--receipt-reserve={inlineReceipts ? `${String(receiptWidth)}px` : undefined}
            {@attach inlineReceipts ? receiptReserve : undefined}
          >
            * <SenderName
              displayName={emoteName}
              colors={senderColors}
              onMention={nameMentions ? mentionSender : undefined}
              onProfile={nameOpensProfile ? openSenderProfileAt : undefined}
            />
            <FormattedBody html={item.content.html} {senderTimezone} {onMatrixLink} />
            {#if inlineReceipts}
              <span class="receipt-space" aria-hidden="true"></span>
              {@render receiptSlot()}
            {/if}
          </div>
        {:else if item.content.kind === 'message' && editor}
          {@render editor()}
        {:else if item.content.kind === 'message'}
          {@const inlineReceipts = receiptsVisible && receiptsInline}
          <div
            class={[
              jumbo === null ? undefined : `jumbo jumbo-${String(jumbo)}`,
              { notice, 'has-edited': item.content.edited, 'has-receipts': inlineReceipts },
            ]}
            style:--receipt-reserve={inlineReceipts ? `${String(receiptWidth)}px` : undefined}
            {@attach inlineReceipts ? receiptReserve : undefined}
          >
            <FormattedBody html={item.content.html} {senderTimezone} {onMatrixLink} />
            <!-- After the body, where the edit happened. -->
            {#if item.content.edited}
              <span class="edited">{i18n.t('timeline.edited')}</span>
            {/if}
            {#if inlineReceipts}
              <span class="receipt-space" aria-hidden="true"></span>
              {@render receiptSlot()}
            {/if}
          </div>
          {#if bundledPreviews.length > 0}
            {#each bundledPreviews as preview (preview.url)}
              <LinkEmbed url={preview.url} bundled={preview} {encrypted} />
            {/each}
          {:else}
            {#each previewUrls as url (url)}
              <LinkEmbed {url} {encrypted} />
            {/each}
          {/if}
        {:else if item.content.kind === 'redacted'}
          {@const inlineReceipts = receiptsVisible && receiptsInline}
          <div
            class={{ 'content-bubble': layout === 'bubble', 'has-receipts': inlineReceipts }}
            style:--receipt-reserve={inlineReceipts ? `${String(receiptWidth)}px` : undefined}
            {@attach inlineReceipts ? receiptReserve : undefined}
          >
            <MessageBody
              {item}
              {canRedactOthers}
              redactionReason={item.event_id ? events?.redactionReason(item.event_id) : null}
              redactedBy={events?.redactor(item) ?? item.content.redacted_by ?? null}
            />
            {#if inlineReceipts}
              <span class="receipt-space" aria-hidden="true"></span>
              {@render receiptSlot()}
            {/if}
          </div>
        {:else}
          <div class={{ 'content-bubble': layout === 'bubble' && nonTextContent }}>
            <MessageBody
              {item}
              {senderTimezone}
              {members}
              {canRedactOthers}
              {encrypted}
              {onMatrixLink}
              {onOpenMedia}
              {onVotePoll}
              {onEndPoll}
              {onSenderProfile}
            />
          </div>
        {/if}
        {#if threadSummary && onOpenThread && threadTarget}
          {@const target = threadTarget}
          <TimelineThreadSummary
            summary={threadSummary}
            persona={threadPersona}
            onOpen={() => {
              onOpenThread(target);
            }}
          />
        {:else if item.thread_root && onOpenThread}
          {@const target = item.thread_root}
          <TimelineThreadSummary
            summary={null}
            onOpen={() => {
              onOpenThread(target);
            }}
          />
        {/if}
        {#if item.reactions.length > 0}
          <MessageReactions
            reactions={item.reactions}
            eventId={item.event_id}
            {currentUserId}
            {members}
            {roomId}
            {actionable}
            onReact={actions.onReact}
            {onToggleReaction}
            onViewReactions={(index: number) => {
              dialogs.open(item, { kind: 'reactions', active: index });
            }}
          />
        {/if}
        {#if uploadFraction !== null}
          <TimelineTransfer
            label={i18n.t('timeline.uploading')}
            max={1}
            value={uploadFraction}
            count={uploadItem === null
              ? null
              : i18n.t('timeline.uploadingItem', { current: uploadItem, count: galleryCount })}
            onCancel={item.transaction_id ? cancelUpload : undefined}
          />
        {:else if uploading}
          <TimelineTransfer
            label={i18n.t('timeline.uploading')}
            onCancel={item.transaction_id ? cancelUpload : undefined}
          />
        {:else if saving.percent !== null}
          <TimelineTransfer
            label={i18n.t('timeline.downloading')}
            max={100}
            value={saving.percent}
          />
        {:else if actionExecutor.savingSlow}
          <TimelineTransfer label={i18n.t('timeline.downloading')} />
        {/if}
        {#if stalled}
          <TimelineSendFailure
            failure={stalled}
            transactionId={item.transaction_id}
            {members}
            {onRetrySend}
            {onCancelSend}
          />
        {/if}
        {#if trailingReceiptBadge}
          <span class="receipt-tail" aria-hidden="true"></span>
        {/if}
      </div>
      {#if trailingReceiptBadge}
        {@render receiptSlot()}
      {/if}
    </div>
  </article>
{:else if isAnnotation(item)}
  <TimelineNotice
    {item}
    {unreadCount}
    {roomId}
    {events}
    {members}
    {currentUserId}
    {onSenderProfile}
    {onJumpToEvent}
  />
{:else}
  <article
    bind:this={messageRow}
    class={['message', 'event-row', { highlighted }]}
    data-selected={selected ? 'true' : undefined}
    style:--sender-name-color={senderColors.nameColor}
    style:--name-color-on-light={senderColors.nameColorLight ?? undefined}
    style:--name-color-on-dark={senderColors.nameColorDark ?? undefined}
    style:transform={swipe.offset === 0 ? undefined : `translateX(${String(-swipe.offset)}px)`}
    style:transition={swipe.dragging ? 'none' : undefined}
    onpointerdown={rowPointerDown}
    onpointermove={rowPress.move}
    onpointerup={rowPointerUp}
    onpointercancel={rowPointerCancel}
    onpointerenter={engagement.engage}
    onpointerleave={engagement.disengage}
    onfocusin={engagement.engage}
    onfocusout={engagement.disengage}
    oncontextmenu={openContextMenu}
    {@attach swipe.attach}
  >
    {#if swipe.offset > 0}
      <TimelineSwipeAction offset={swipe.offset} armed={swipe.action !== 'none'} />
    {/if}
    {@render actionLayer()}
    <TimelineNotice
      {item}
      {unreadCount}
      {roomId}
      {events}
      {members}
      {currentUserId}
      {onSenderProfile}
      {onJumpToEvent}
    />
    {#if item.reactions.length > 0}
      <div class="event-reactions">
        <span class="event-rail" aria-hidden="true"></span>
        <MessageReactions
          reactions={item.reactions}
          eventId={item.event_id}
          {currentUserId}
          {members}
          {roomId}
          {actionable}
          onReact={actions.onReact}
          {onToggleReaction}
          onViewReactions={(index: number) => {
            dialogs.open(item, { kind: 'reactions', active: index });
          }}
        />
      </div>
    {/if}
  </article>
{/if}

<style>
  .placeholder-message {
    pointer-events: none;
  }

  .placeholder-message :global(.skeleton) {
    background: color-mix(in srgb, var(--bg-on-container) 18%, var(--bg-container));
  }

  .placeholder-body {
    line-height: var(--line-height-body);
  }

  .placeholder-copy {
    background: color-mix(in srgb, var(--bg-on-container) 18%, var(--bg-container));
    border-radius: var(--radius);
    box-decoration-break: clone;
    color: transparent;
    overflow-wrap: anywhere;
    user-select: none;
  }

  @media (prefers-reduced-motion: no-preference) {
    :global(html:not([data-reduced-motion='on'])) .placeholder-copy {
      animation: skeleton-pulse 1.8s ease-in-out infinite;
    }
  }

  :global(.skeleton.placeholder-avatar) {
    background: color-mix(in srgb, var(--bg-on-container) 24%, var(--bg-container));
    border-radius: var(--radii-400);
  }

  :global(.skeleton.placeholder-name) {
    height: var(--font-size-body);
    width: 6.5rem;
  }

  :global(.skeleton.placeholder-time) {
    height: var(--font-size-small);
    width: 3rem;
  }

  @media (pointer: coarse) {
    .message {
      touch-action: manipulation;
      -webkit-touch-callout: none;
      user-select: none;
    }

    .message :global(.formatted-body),
    .message :global(pre),
    .message :global(code) {
      user-select: none;
    }
  }

  .message {
    display: flex;
    gap: var(--timeline-row-gap);
    margin-inline: calc(-1 * var(--page-gutter));
    overflow-wrap: anywhere;
    padding: var(--timeline-row-padding) var(--page-gutter);
    position: relative;
  }

  @media (any-pointer: fine) {
    .message {
      user-select: text;
    }
  }

  .message:not(.layout-compact) > :global(.avatar-button),
  .message:not(.layout-compact) > :global(.avatar-root.message-avatar) {
    translate: 0 var(--space-100);
  }

  @media (prefers-reduced-motion: no-preference) {
    .message {
      transition: transform var(--duration-fast) var(--ease-smooth-out);
    }
  }

  .message.event-row {
    display: block;
    padding-block: 0;
  }

  .event-reactions {
    display: flex;
    gap: var(--timeline-row-gap);
  }

  .event-rail {
    flex: 0 0 var(--avatar-size-small);
  }

  .message:focus-within :global(.message-actions) {
    opacity: 1;
    pointer-events: auto;
  }

  .message.mention-silent,
  .message.mention-loud {
    --mention-gutter: calc(var(--space-200) + var(--border-width) * 4);

    border-inline-start: calc(var(--border-width) * 4) solid;
    border-radius: 0 var(--radius) var(--radius) 0;
    margin-inline: calc(-1 * var(--mention-gutter)) calc(-1 * var(--space-200));
    padding-inline: var(--space-200);
  }

  .message.mention-silent {
    background: color-mix(in srgb, var(--sec-container) 25%, transparent);
    border-inline-start-color: var(--sec-container-line);
  }

  .message.mention-loud {
    background: color-mix(in srgb, var(--warn-container) 25%, transparent);
    border-inline-start-color: var(--warn-container-line);
  }

  /* The sheet pairs multi-select with keyboard focus; focus is the half that
     exists today, and it survives on touch where hover does not. */
  .message[data-selected='true'] {
    background: var(--surface-container-active);
    border-radius: var(--radius);
    box-shadow: inset 0 0 0 var(--border-width) var(--surface-container-line);
  }

  .message:has(:focus-visible):not([data-selected='true'], :has(.reply-preview:focus-visible)) {
    background: var(--bg-container-hover);
    border-radius: var(--radius);
    color: var(--bg-on-container);
  }

  .message.collapsed {
    padding-left: calc(var(--page-gutter) + var(--avatar-size-small) + var(--timeline-row-gap));
    padding-top: 0;
  }

  .message.collapsed.mention-silent,
  .message.collapsed.mention-loud {
    padding-left: calc(var(--avatar-size-small) + var(--timeline-row-gap) + var(--space-200));
  }

  .message.highlighted {
    --message-highlight-duration: 6s;
  }

  .message.highlighted:not(.mention-silent, .mention-loud) {
    border-radius: var(--radius);
  }

  .message.pressed {
    background: var(--bg-container-active);
    border-radius: var(--radius);
    color: var(--bg-on-container);
  }

  /* Glyph sizes for emoji-only messages, deliberately off the type scale. */
  .jumbo {
    --jumbo-size-1: 2.4rem;
    --jumbo-size-2: 1.9rem;
    --jumbo-size-3: 1.5rem;
    --jumbo-size-4: 1.25rem;
  }

  .jumbo :global(.formatted-body img) {
    height: 1em;
    vertical-align: middle;
  }

  .jumbo-1 {
    font-size: var(--jumbo-size-1);
    line-height: 1.15;
  }

  .jumbo-2 {
    font-size: var(--jumbo-size-2);
    line-height: 1.2;
  }

  .jumbo-3 {
    font-size: var(--jumbo-size-3);
    line-height: 1.3;
  }

  .jumbo-4 {
    font-size: var(--jumbo-size-4);
    line-height: 1.35;
  }

  @keyframes jump {
    0% {
      background-color: var(--primary-container);
      color: var(--primary-on-container);
    }

    16% {
      background-color: var(--primary-container-active);
      color: var(--primary-on-container);
    }

    33%,
    100% {
      background-color: transparent;
      color: inherit;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    :global(html:not([data-reduced-motion='on'])) .message.highlighted {
      animation: jump var(--message-highlight-duration) var(--motion-easing-standard);
    }
  }

  @keyframes jump-reduced {
    0% {
      background-color: var(--primary-container);
      color: var(--primary-on-container);
    }

    33%,
    100% {
      background-color: transparent;
      color: inherit;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .message.highlighted {
      animation: jump-reduced var(--message-highlight-duration) steps(1, end);
    }
  }

  :global(html[data-reduced-motion='on']) .message.highlighted {
    animation: jump-reduced var(--message-highlight-duration) steps(1, end);
  }

  @media (width >= 48rem) and (any-hover: hover) and (any-pointer: fine) {
    /* Matches the base mention rule's specificity, so the gutter the row's
       negative margin assumes survives. */
    .message.mention-silent,
    .message.mention-loud {
      margin-inline: calc(-1 * var(--page-gutter));
      padding-inline: calc(var(--page-gutter) - var(--space-100)) var(--page-gutter);
    }

    /* The rule above resets the whole shorthand, and a collapsed row still
       owes the avatar gutter. */
    .message.collapsed.mention-silent,
    .message.collapsed.mention-loud {
      padding-left: calc(
        var(--page-gutter) - var(--space-100) + var(--avatar-size-small) + var(--timeline-row-gap)
      );
    }

    .message:hover,
    .message.menu-open {
      background-color: var(--surface-container-hover);
    }

    .message:hover :global(.message-actions) {
      opacity: 1;
      pointer-events: auto;
    }

    .message:hover :global(.via-hidden) {
      opacity: 1;
      pointer-events: auto;
    }
  }

  .message-content {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    position: relative;
  }

  .message-content > header {
    grid-column: 1 / -1;
  }

  .message-main {
    font-size: var(--font-size-editor);
    grid-column: 1;
    min-width: 0;
  }

  .receipt-slot {
    display: flex;
    user-select: none;
  }

  .message-content > .receipt-slot {
    inset-block-end: 0;
    inset-inline-end: 0;
    position: absolute;
  }

  .has-receipts :global(.formatted-body) {
    display: inline;
  }

  .has-receipts :global(.formatted-body > p:only-child) {
    display: inline;
  }

  .has-receipts .receipt-slot {
    inset-block-end: 0;
    inset-inline-end: 0;
    position: absolute;
  }

  .receipt-space {
    display: inline-block;
    inline-size: var(--receipt-reserve);
    user-select: none;
  }

  .has-receipts:global([data-receipt-narrow]) {
    padding-inline-end: calc(var(--receipt-reserve) + var(--space-200));
  }

  .has-receipts:global([data-receipt-narrow]) .receipt-space {
    display: none;
  }

  .message header {
    align-items: center;
    display: flex;
    gap: var(--space-200);
    min-width: 0;
  }

  .sender-role {
    display: inline-flex;
  }

  .message header :global(.sender-identity) {
    flex-shrink: 1;
  }

  .message header .message-details {
    align-items: center;
    display: flex;
    flex-grow: 1;
    flex-shrink: 0;
    font-size: var(--font-size-small);
    justify-content: end;
    min-width: 0;
  }

  .persona {
    --ink-on-light: var(--pmp-on-light, var(--sec-on-container));
    --ink-on-dark: var(--pmp-on-dark, var(--sec-on-container));
    --pmp-ink: var(--ink);
  }

  .message.persona :global(.message-avatar) {
    color: var(--pmp-ink);
  }

  .message.persona :global(.message-avatar .avatar-fallback) {
    background: color-mix(in oklab, var(--pmp-ink) 18%, var(--surface-var-container));
  }

  .via {
    background: none;
    border: none;
    cursor: pointer;
    flex-grow: 1;
    letter-spacing: 0.01em;
    max-width: max-content;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 0;
  }

  .via.via-hidden {
    display: none;
  }

  @media (width >= 48rem) {
    .via.via-hidden {
      display: revert;
      opacity: 0;
    }
  }

  .via:hover {
    text-decoration: underline;
  }

  .emote {
    color: var(--success-main);
    font-style: italic;
    line-height: var(--line-height-body);
  }

  .emote .sender {
    font-style: normal;
  }

  .message.persona .sender {
    color: var(--pmp-ink);
  }

  .emote :global(.formatted-body) {
    display: inline;
  }

  .has-edited {
    line-height: var(--line-height-body);
  }

  .has-edited :global(.formatted-body) {
    display: inline;
  }

  time,
  .edited {
    color: var(--surface-var-on-container);
  }

  .message-details time {
    flex-shrink: 0;
  }

  .message-time-action {
    background: none;
    border: 0;
    cursor: pointer;
    flex: none;
    font: inherit;
    padding: 0;
    white-space: nowrap;
  }

  .message-time-action:hover {
    text-decoration: underline;
  }

  .edited {
    font-size: var(--font-size-small);
    margin-inline-start: var(--space-100);
  }

  /* `m.notice` is usually a bot, and reads as an aside. */
  .notice {
    color: light-dark(
      color-mix(var(--surface-var-on-container), var(--primary-main) 70%),
      var(--surface-var-on-container)
    );
  }

  .message.has-connected-reply:not(.layout-compact) > :global(.avatar-button),
  .message.has-connected-reply:not(.layout-compact) > :global(.avatar-root.message-avatar) {
    margin-top: var(--space-600);
  }

  @media (prefers-reduced-motion: no-preference) {
    .via {
      transition: background-color var(--motion-fast) var(--motion-easing-standard);
    }

    .via-hidden {
      transition: opacity var(--motion-fast) var(--motion-easing-standard);
    }
  }

  .message.mention-loud :global(a[data-matrix-link]) {
    background: var(--warn-container-active);
    border-color: var(--warn-container-line);
    color: var(--warn-on-container);
  }

  .message[data-selected='true'] .body,
  .message[data-selected='true'] time {
    color: var(--surface-on-container);
  }

  /* Layout modes stay in one block at the end: each overrides a base rule
     above, and a second copy elsewhere would drift out of sync. */
  .message.layout-compact .message-content {
    column-gap: var(--space-300);
    grid-template-columns: clamp(7.5rem, 20%, 10.625rem) minmax(0, 1fr);
  }

  .message.layout-compact .message-content > :global(.reply-preview) {
    grid-column: 2;
    grid-row: 1;
  }

  .message.layout-compact .message-main {
    grid-column: 2;
    grid-row: 2;
  }

  .message.layout-compact.collapsed {
    padding-inline: var(--page-gutter);
  }

  .compact-gutter {
    align-items: center;
    display: flex;
    gap: var(--space-200);
    grid-column: 1;
    grid-row: 2;
    height: fit-content;
    justify-content: space-between;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .message.has-connected-reply .compact-gutter {
    grid-row: 1;
  }

  .message.layout-compact .compact-gutter time {
    color: var(--surface-var-on-container);
    flex: none;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
  }

  .compact-user {
    display: flex;
    font-size: inherit;
    gap: var(--space-100);
  }

  .message.layout-bubble .message-main {
    align-items: flex-start;
    display: flex;
    flex-direction: column;
  }

  .message.layout-bubble .message-main > *,
  .message.layout-bubble
    .message-main
    > :global(:where(.reply-preview, .thread-summary, .transfer, .send-failure)) {
    max-width: min(50rem, 100%);
    min-width: 0;
  }

  .message.layout-bubble .content-bubble,
  .message.layout-bubble :global(.formatted-body) {
    background: var(--surface-var-container);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius);
    color: var(--surface-var-on-container);
    max-width: min(50rem, 100%);
    padding: var(--space-200) var(--space-300);
  }

  .message.layout-bubble .content-bubble :global(.formatted-body) {
    background: none;
    border: 0;
    padding: 0;
  }

  .message.layout-bubble .content-bubble :global(.image) {
    margin-top: 0;
  }

  .message.layout-bubble .content-bubble {
    width: var(--timeline-bubble-width);
  }

  .message.layout-bubble .has-edited :global(.formatted-body) {
    display: inline-block;
  }

  .message.layout-bubble .has-receipts {
    padding-inline-end: calc(var(--receipt-reserve) + var(--space-200));
  }

  .message.layout-bubble .has-receipts:not(.content-bubble) {
    max-width: min(100%, calc(50rem + var(--receipt-reserve) + var(--space-200)));
  }

  .message.layout-bubble .has-receipts :global(.formatted-body) {
    display: inline-block;
  }

  .message.layout-bubble .receipt-space,
  .message.layout-bubble .receipt-tail {
    display: none;
  }

  .message:not(.layout-bubble) .message-main:has(> .receipt-tail) {
    align-items: flex-end;
    display: flex;
    flex-wrap: wrap;
  }

  .message:not(.layout-bubble) .message-main:has(> .receipt-tail) > *,
  .message:not(.layout-bubble)
    .message-main:has(> .receipt-tail)
    > :global(:where(.reply-preview, .thread-summary, .transfer, .send-failure)) {
    flex: 0 0 100%;
    min-width: 0;
  }

  .message:not(.layout-bubble) .message-main:has(> .receipt-tail) > :nth-last-child(2),
  .message:not(.layout-bubble)
    .message-main:has(> .receipt-tail)
    > :global(:where(.reply-preview, .thread-summary, .transfer, .send-failure)):nth-last-child(2) {
    flex: 0 1 auto;
  }

  .message:not(.layout-bubble.own.align-own)
    .message-main:has(> .receipt-tail)
    > :global(.reactions):nth-last-child(2),
  .message:not(.layout-bubble)
    .message-main:has(> .receipt-tail)
    > :nth-last-child(2):has(:global(.media-frame-audio, .poll, .location)) {
    flex-basis: calc(100% - var(--receipt-reserve) - var(--space-200));
    max-width: calc(100% - var(--receipt-reserve) - var(--space-200));
  }

  .message:not(.layout-bubble) .message-main > .receipt-tail {
    block-size: var(--size-x300);
    flex: none;
    inline-size: calc(var(--receipt-reserve) + var(--space-200));
    margin-inline-start: auto;
    user-select: none;
  }

  .message.layout-bubble:not(.own.align-own)
    .message-main:has(> .receipt-tail)
    > :nth-last-child(2),
  .message.layout-bubble:not(.own.align-own)
    .message-main:has(> .receipt-tail)
    > :global(:where(.reply-preview, .thread-summary, .transfer, .send-failure)):nth-last-child(2) {
    margin-inline-end: calc(var(--receipt-reserve) + var(--space-200));
  }

  .message.layout-bubble.own.align-own
    .message-main:has(> .receipt-tail)
    > :global(*):nth-last-child(2) {
    margin-inline-end: max(
      calc(var(--space-100) * 0),
      calc(var(--receipt-reserve) + var(--space-200) - var(--avatar-size-small) - var(--space-250))
    );
  }

  .message.layout-bubble.own.align-own .has-edited {
    align-items: flex-end;
    display: flex;
    flex-direction: row-reverse;
    gap: var(--space-100);
  }

  .message.layout-bubble.own.align-own .has-edited .edited {
    margin-inline-start: 0;
  }

  /* The one mode where your own side changes. */
  .message.layout-bubble.own.align-own {
    flex-direction: row-reverse;
  }

  .message.layout-bubble.own.align-own .message-main {
    align-items: flex-end;
    grid-column: 1 / -1;
  }

  .message.layout-bubble.own.align-own header {
    flex-direction: row-reverse;
  }

  .message.layout-bubble.own.align-own.collapsed {
    padding-left: 0;
    padding-right: calc(var(--avatar-size-small) + var(--space-250));
  }

  .message.layout-bubble.own.align-own .message-content > .receipt-slot {
    margin-inline-end: calc(-1 * (var(--avatar-size-small) + var(--timeline-row-gap)));
  }

  .message.layout-bubble.own.align-own.collapsed .message-content > .receipt-slot {
    margin-inline-end: calc(-1 * (var(--avatar-size-small) + var(--space-250)));
  }
</style>
