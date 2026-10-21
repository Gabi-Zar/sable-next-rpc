import type { TimelineItemView } from '#src/generated/protocol';

export type MediaCaptionContent = Extract<
  TimelineItemView['content'],
  { kind: 'image' | 'video' | 'audio' | 'file' }
>;

export function isMediaCaptionContent(
  content: TimelineItemView['content']
): content is MediaCaptionContent {
  return (
    content.kind === 'image' ||
    content.kind === 'video' ||
    content.kind === 'audio' ||
    content.kind === 'file'
  );
}
