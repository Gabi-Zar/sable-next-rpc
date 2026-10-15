const STORE_LOCK = 'sable-core-store';
const HUNG_OWNER_MS = 10_000;

type Claim = { claimant: string };

/**
 * Two live cores on one store corrupt Olm sessions, so a newer worker asks the
 * owner to close and waits, stealing the lock only from a hung owner.
 */
export function claimStore(onSuperseded: () => void): Promise<void> {
  if (!('locks' in navigator) || typeof BroadcastChannel === 'undefined') {
    return Promise.resolve();
  }
  const { locks } = navigator;
  const channel = new BroadcastChannel(STORE_LOCK);

  const claimant = crypto.randomUUID();
  let superseded = false;
  const supersede = () => {
    if (superseded) return;
    superseded = true;
    onSuperseded();
  };

  channel.onmessage = ({ data }: MessageEvent<Claim>) => {
    if (data.claimant !== claimant) supersede();
  };
  channel.postMessage({ claimant } satisfies Claim);

  return new Promise<void>((owned) => {
    const hold = () => {
      owned();
      return new Promise<never>(() => {});
    };
    const waiting = new AbortController();
    const stealTimer = setTimeout(() => {
      waiting.abort();
      locks.request(STORE_LOCK, { steal: true }, hold).catch(supersede);
    }, HUNG_OWNER_MS);

    locks
      .request(STORE_LOCK, { signal: waiting.signal }, () => {
        clearTimeout(stealTimer);
        return hold();
      })
      .catch(() => {
        // Our own steal aborts this wait; any other rejection is a newer worker stealing.
        if (!waiting.signal.aborted) supersede();
      });
  });
}
