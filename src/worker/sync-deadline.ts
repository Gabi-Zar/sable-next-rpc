// The SDK's wasm HTTP client drops `RequestConfig::timeout`, so a long-poll left on a socket that
// died while the computer slept would hang forever. Natively it gets poll_timeout + network_timeout.
const SYNC_TIMEOUT_MS = 60_000;
const SYNC_PATH = /^\/_matrix\/client\/(unstable\/org\.matrix\.simplified_msc3575|v5)\/sync$/;

type Fetch = typeof fetch;

function isSync(request: Request): boolean {
  return request.method === 'POST' && SYNC_PATH.test(new URL(request.url).pathname);
}

export function withSyncDeadline(base: Fetch): Fetch {
  return (input, init) => {
    if (!(input instanceof Request) || init !== undefined || !isSync(input)) {
      return base(input, init);
    }
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(SYNC_TIMEOUT_MS)]);
    return base(new Request(input, { signal }));
  };
}

export function installSyncDeadline(scope: { fetch: Fetch }): void {
  scope.fetch = withSyncDeadline(scope.fetch.bind(scope));
}
