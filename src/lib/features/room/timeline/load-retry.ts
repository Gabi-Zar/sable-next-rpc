import { automaticMediaRetryDelay } from '#lib/ui/media-retry.js';

export class LoadRetry {
  #attempts = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  schedule(retry: () => void): void {
    if (this.#timer !== undefined) return;
    const delay = automaticMediaRetryDelay(this.#attempts + 1);
    if (delay === null) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#attempts += 1;
      retry();
    }, delay);
  }

  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  reset(): void {
    this.cancel();
    this.#attempts = 0;
  }
}
