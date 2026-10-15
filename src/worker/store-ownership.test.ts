import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { claimStore } from './store-ownership';

type Waiter = { grant: () => void; reject: (error: unknown) => void };

class FakeLocks {
  private holder: Waiter | null = null;
  private readonly queue: Waiter[] = [];

  request(
    _name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<unknown>
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          this.holder = waiter;
          void callback(null).then(resolve, reject);
        },
        reject,
      };
      options.signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(waiter);
        if (index === -1) return;
        this.queue.splice(index, 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
      if (options.steal) {
        this.holder?.reject(new DOMException('stolen', 'AbortError'));
        waiter.grant();
      } else if (this.holder) {
        this.queue.push(waiter);
      } else {
        waiter.grant();
      }
    });
  }

  release(): void {
    this.holder = null;
    this.queue.shift()?.grant();
  }
}

const channels = new Set<FakeChannel>();

class FakeChannel {
  onmessage: ((message: MessageEvent) => void) | null = null;

  constructor() {
    channels.add(this);
  }

  postMessage(data: unknown): void {
    for (const channel of channels) {
      if (channel !== this) channel.onmessage?.({ data } as MessageEvent);
    }
  }
}

function claim(locks: FakeLocks, onSuperseded = vi.fn()) {
  vi.stubGlobal('navigator', { locks });
  let owned = false;
  void claimStore(onSuperseded).then(() => {
    owned = true;
  });
  return { onSuperseded, owned: () => owned };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
});

afterEach(() => {
  channels.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a newer worker waits for the owner to close instead of running beside it', async () => {
  const locks = new FakeLocks();
  const owner = claim(locks);
  await vi.advanceTimersByTimeAsync(0);
  expect(owner.owned()).toBe(true);

  const newer = claim(locks);
  await vi.advanceTimersByTimeAsync(0);
  expect(owner.onSuperseded).toHaveBeenCalledOnce();
  expect(newer.owned()).toBe(false);

  locks.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(newer.owned()).toBe(true);
  expect(newer.onSuperseded).not.toHaveBeenCalled();
});

test('an owner that never closes loses the store to a steal', async () => {
  const locks = new FakeLocks();
  const owner = claim(locks);
  await vi.advanceTimersByTimeAsync(0);

  const newer = claim(locks);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(newer.owned()).toBe(false);

  await vi.advanceTimersByTimeAsync(1);
  expect(newer.owned()).toBe(true);
  expect(owner.onSuperseded).toHaveBeenCalledOnce();
  expect(newer.onSuperseded).not.toHaveBeenCalled();
});

test('a waiter superseded before its turn never opens the store', async () => {
  const locks = new FakeLocks();
  claim(locks);
  await vi.advanceTimersByTimeAsync(0);
  const queued = claim(locks);
  await vi.advanceTimersByTimeAsync(0);
  claim(locks);
  await vi.advanceTimersByTimeAsync(0);
  expect(queued.onSuperseded).toHaveBeenCalledOnce();

  locks.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(queued.owned()).toBe(false);
});

test('a browser without Web Locks owns the store at once', async () => {
  vi.stubGlobal('navigator', {});
  const onSuperseded = vi.fn();
  await expect(claimStore(onSuperseded)).resolves.toBeUndefined();
  expect(channels.size).toBe(0);
});
