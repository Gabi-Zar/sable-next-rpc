const TYPING_TIMEOUT_MS = 4000;

export class TypingNotifier {
  #timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly roomId: () => string,
    private readonly notify: (roomId: string, typing: boolean) => Promise<void>
  ) {}

  update(empty: boolean): void {
    if (this.#timeout) clearTimeout(this.#timeout);
    if (empty) {
      this.#send(this.roomId(), false);
      return;
    }

    this.#send(this.roomId(), true);
    this.#timeout = setTimeout(() => {
      this.#send(this.roomId(), false);
    }, TYPING_TIMEOUT_MS);
  }

  stop(): void {
    if (this.#timeout) clearTimeout(this.#timeout);
    this.#send(this.roomId(), false);
  }

  leave(roomId: string): void {
    if (!this.#timeout) return;
    clearTimeout(this.#timeout);
    this.#timeout = undefined;
    this.#send(roomId, false);
  }

  #send(roomId: string, typing: boolean): void {
    this.notify(roomId, typing).catch((error: unknown) => {
      console.debug('[sable composer] typing notification failed', error);
    });
  }
}
