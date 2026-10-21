import type { CoreClient } from '#lib/core/client.svelte.js';
import { cachedMediaUrl, holdMediaUrl, loadMediaUrl } from '#lib/ui/media-url.js';

export class MediaViewerResource {
  url = $state<string | null>(null);
  failed = $state(false);

  #generation = 0;
  #release: (() => void) | null = null;

  constructor(private readonly core: CoreClient) {}

  load(source: string | null, mime: string | null): () => void {
    this.#releaseCurrent();
    const generation = ++this.#generation;
    this.url = null;
    this.failed = false;
    if (source === null) return () => {};

    const release = holdMediaUrl(this.core, source, 0, 0);
    this.#release = release;
    const cached = cachedMediaUrl(this.core, source, 0, 0);
    this.url = cached ?? null;
    void (cached ? Promise.resolve(cached) : loadMediaUrl(this.core, source, 0, 0, mime))
      .then((url) => {
        if (generation === this.#generation) this.url = url;
      })
      .catch((error: unknown) => {
        console.warn('[sable viewer] media load failed', error);
        if (generation === this.#generation) this.failed = true;
      });

    return () => {
      if (generation !== this.#generation) return;
      this.#generation += 1;
      this.#releaseCurrent();
    };
  }

  dispose(): void {
    this.#generation += 1;
    this.#releaseCurrent();
  }

  #releaseCurrent(): void {
    this.#release?.();
    this.#release = null;
  }
}
