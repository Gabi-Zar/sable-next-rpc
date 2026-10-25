import type { TimelineItemView } from '#src/generated/protocol';
import type { MediaItem } from './media-viewer-types.js';
import { timelineMediaItems } from './media-items.js';

class MediaViewerState {
  eventId = $state<string | null>(null);
  standaloneItem = $state<MediaItem | null>(null);
  panelItems = $state.raw<MediaItem[] | null>(null);
  timelineItems = $state<() => readonly TimelineItemView[]>(() => []);
  onJump: (eventId: string) => void = () => [];
  canJump: boolean = false;
  items = $derived.by(() =>
    this.standaloneItem
      ? [this.standaloneItem]
      : (this.panelItems ?? timelineMediaItems(this.timelineItems()))
  );
  #standaloneSequence = 0;

  open(eventId: string, canJump?: boolean): void {
    this.standaloneItem = null;
    this.panelItems = null;
    this.canJump = canJump ?? false;
    this.eventId = eventId;
  }

  openPanel(items: MediaItem[], eventId: string, canJump?: boolean): void {
    this.standaloneItem = null;
    this.panelItems = items;
    this.canJump = canJump ?? false;
    this.eventId = eventId;
  }

  openStandalone(
    source: string,
    displayName: string,
    mime?: string | null,
    width?: number | null,
    height?: number | null
  ): void {
    const standalone: MediaItem = {
      kind: 'image',
      filename: displayName,
      caption: null,
      html: null,
      source,
      mime: mime ?? null,
      width: width ?? null,
      height: height ?? null,
      size: null,
      blurhash: null,
      thumbnail: null,
      spoiler: null,
      animated: null,
      sender: displayName,
      eventId: `standalone-${String(++this.#standaloneSequence)}`,
    };

    this.standaloneItem = standalone;
    this.panelItems = null;
    this.canJump = false;
    this.eventId = standalone.eventId;
  }

  close(): void {
    this.standaloneItem = null;
    this.panelItems = null;
    this.canJump = false;
    this.eventId = null;
  }
}

export const mediaViewerState = new MediaViewerState();
