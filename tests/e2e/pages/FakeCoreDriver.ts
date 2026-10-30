import type { Page } from '@playwright/test';

type TimelineDiff = Record<string, unknown>;

export class FakeCoreDriver {
  constructor(private readonly page: Page) {}

  commands(): Promise<string[]> {
    return this.page.evaluate(() => window.__e2eCommands);
  }

  timelineCommands(): Promise<string[]> {
    return this.page.evaluate(() =>
      window.__e2eCommands.filter(
        (command) => command === 'timeline.subscribe' || command === 'timeline.paginate'
      )
    );
  }

  subscribeCount(): Promise<number> {
    return this.page.evaluate(
      () => window.__e2eCommands.filter((command) => command === 'timeline.subscribe').length
    );
  }

  paginateCount(): Promise<number> {
    return this.page.evaluate(
      () => window.__e2eCommands.filter((command) => command === 'timeline.paginate').length
    );
  }

  mediaFetches(): Promise<string[]> {
    return this.page.evaluate(() =>
      window.__e2eCommands.filter((command) => command.startsWith('fetch_media'))
    );
  }

  async holdMedia(): Promise<void> {
    await this.page.evaluate(() => {
      window.__e2eMediaReady = new Promise<void>((resolve) => {
        window.__e2eReleaseMedia = resolve;
      });
    });
  }

  async releaseMedia(): Promise<void> {
    await this.page.evaluate(() => {
      window.__e2eReleaseMedia();
    });
  }

  subscription(index = 0): Promise<number> {
    return this.page.evaluate((at) => window.__e2eTimelineSubscriptions[at], index);
  }

  async emitTimelineDiff(subscription: number, diffs: TimelineDiff[]): Promise<void> {
    await this.page.evaluate(
      ({ subscription, diffs }) => {
        window.__e2eEmitTimelineEvent({ type: 'timeline_diff', subscription, diffs });
      },
      { subscription, diffs }
    );
  }

  indexOfTimelineItem(subscription: number, itemId: string): Promise<number> {
    return this.page.evaluate(
      ({ subscription, itemId }) => window.__e2eTimelineIndexOf(subscription, itemId),
      { subscription, itemId }
    );
  }

  async setTimelineItemById(
    subscription: number,
    itemId: string,
    value: TimelineDiff
  ): Promise<void> {
    await this.page.evaluate(
      ({ subscription, itemId, value }) => {
        const index = window.__e2eTimelineIndexOf(subscription, itemId);
        if (index < 0) throw new Error(`no core item ${itemId} in subscription ${subscription}`);
        window.__e2eEmitTimelineEvent({
          type: 'timeline_diff',
          subscription,
          diffs: [{ op: 'set', index, value }],
        });
      },
      { subscription, itemId, value }
    );
  }

  async emitTyping(roomId: string, userIds: string[]): Promise<void> {
    await this.page.evaluate(
      ({ roomId, userIds }) => {
        window.__e2eEmitTimelineEvent({ type: 'typing', room_id: roomId, user_ids: userIds });
      },
      { roomId, userIds }
    );
  }

  // Samples every frame, so a mid-flight jump cannot hide between two settled
  // measurements.
  async sampleAnchorWhile(
    itemId: string,
    subscription: number,
    diffs: TimelineDiff[],
    durationMs: number
  ): Promise<number[]> {
    return this.page.evaluate(
      async ({ itemId, subscription, diffs, durationMs }) => {
        const positions: number[] = [];
        const sample = (): void => {
          const anchor = document.querySelector<HTMLElement>(`[data-item-id="${itemId}"]`);
          positions.push(
            anchor
              ? (anchor.firstElementChild ?? anchor).getBoundingClientRect().top
              : Number.POSITIVE_INFINITY
          );
        };
        sample();
        window.__e2eEmitTimelineEvent({ type: 'timeline_diff', subscription, diffs });
        const deadline = performance.now() + durationMs;
        while (performance.now() < deadline) {
          await new Promise(requestAnimationFrame);
          sample();
        }
        return positions;
      },
      { itemId, subscription, diffs, durationMs }
    );
  }
}
