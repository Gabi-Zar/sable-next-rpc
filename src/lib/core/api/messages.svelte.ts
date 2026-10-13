import type {
  ImageSourcePackReferenceView,
  MessageKind,
  PerMessageProfileView,
  UrlPreviewView,
  Rpc,
} from '#src/generated/protocol';

export interface OutgoingMentions {
  userIds: string[];
  room: boolean;
}

const noMentions: OutgoingMentions = { userIds: [], room: false };

export type SendMessageOptions = {
  inReplyTo?: string | null;
  silentReply?: boolean;
  threadRoot?: string | null;
  formatted?: string | null;
  mentions?: OutgoingMentions;
  persona?: PerMessageProfileView | null;
  kind?: MessageKind;
  linkPreviews?: UrlPreviewView[];
  noLinkPreviews?: boolean;
  imageSourcePacks?: ImageSourcePackReferenceView[];
  botCommand?: unknown;
  forumTitle?: string | null;
};

export type EditMessageOptions = Omit<SendMessageOptions, 'inReplyTo' | 'silentReply'> & {
  mediaCaption?: boolean;
  transactionId?: string | null;
};

export async function sendMessage(
  rpc: Rpc,
  roomId: string,
  body: string,
  options: SendMessageOptions = {}
): Promise<void> {
  const mentions = options.mentions ?? noMentions;
  await rpc.messages.send({
    room_id: roomId,
    body,
    formatted: options.formatted ?? null,
    kind: options.kind ?? 'text',
    thread_root: options.threadRoot ?? null,
    in_reply_to: options.inReplyTo ?? null,
    mentions: [...mentions.userIds],
    mentions_room: mentions.room,
    silent_reply: options.silentReply ?? false,
    persona: $state.snapshot(options.persona ?? null),
    link_previews: $state.snapshot(options.linkPreviews ?? []),
    no_link_previews: options.noLinkPreviews ?? false,
    image_source_packs: $state.snapshot(options.imageSourcePacks ?? []),
    bot_command: $state.snapshot(options.botCommand ?? null),
    forum_title: options.forumTitle ?? null,
  });
}

export async function editMessage(
  rpc: Rpc,
  roomId: string,
  eventId: string | null,
  body: string,
  options: EditMessageOptions = {}
): Promise<void> {
  const mentions = options.mentions ?? noMentions;
  await rpc.messages.edit({
    room_id: roomId,
    event_id: eventId,
    transaction_id: options.transactionId ?? null,
    body,
    formatted: options.formatted ?? null,
    kind: options.kind ?? 'text',
    media_caption: options.mediaCaption ?? false,
    thread_root: options.threadRoot ?? null,
    mentions: [...mentions.userIds],
    mentions_room: mentions.room,
    persona: $state.snapshot(options.persona ?? null),
    forum_title: options.forumTitle ?? null,
  });
}
