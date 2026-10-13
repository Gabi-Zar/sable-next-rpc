import { vi } from 'vitest';

const pending = () => new Promise<never>(() => {});

export type CoreStub = ReturnType<typeof createCoreStub>;

type StubRpc = Record<string, Record<string, ReturnType<typeof vi.fn>>>;

export function createCoreStub<T extends Record<string, unknown>>(overrides = {} as T) {
  const defaultRpc = {
    timeline: {
      markRead: vi.fn<(...args: never[]) => Promise<null>>(() => Promise.resolve(null)),
    },
    spaces: {
      unjoinedSpaceParents: vi.fn<(...args: never[]) => Promise<unknown[]>>(() =>
        Promise.resolve([])
      ),
    },
  };
  const stub = {
    session: null as unknown,
    accounts: [] as unknown[],
    fetchMedia: vi.fn<(...args: never[]) => Promise<Uint8Array<ArrayBuffer>>>(pending),
    forgetMedia: vi.fn<(...args: never[]) => Promise<void>>(() => Promise.resolve()),
    userProfile: vi.fn<(...args: never[]) => Promise<unknown>>(() =>
      Promise.reject(new Error('profile unavailable'))
    ),
    cachedUserProfile: vi.fn<(...args: never[]) => unknown>(() => null),
    forgetProfileFailure: vi.fn(),
    refreshUserProfile: vi.fn<(...args: never[]) => Promise<unknown>>(() =>
      Promise.reject(new Error('profile unavailable'))
    ),
    roomPermissions: vi.fn<(...args: never[]) => Promise<unknown>>(pending),
    roomStateEvent: vi.fn<(...args: never[]) => Promise<unknown>>(() => Promise.resolve(null)),
    memberListThreshold: vi.fn<(...args: never[]) => Promise<number | null>>(() =>
      Promise.resolve(null)
    ),
    roomBanner: vi.fn<(...args: never[]) => Promise<string | null>>(() => Promise.resolve(null)),
    canonicalAlias: vi.fn<(...args: never[]) => Promise<unknown>>(() =>
      Promise.resolve({ alias: null, alt_aliases: [] })
    ),
    historyVisibility: vi.fn<(...args: never[]) => Promise<string>>(() =>
      Promise.resolve('shared')
    ),
    powerLevelTags: vi.fn<(...args: never[]) => Promise<unknown>>(() => Promise.resolve({})),
    roomAbbreviations: vi.fn<(...args: never[]) => Promise<unknown[]>>(() => Promise.resolve([])),
    roomViaServers: vi.fn<(...args: never[]) => Promise<string[]>>(() => Promise.resolve([])),
    replacedRooms: vi.fn<(...args: never[]) => Promise<unknown[]>>(() => Promise.resolve([])),
    setRoomTag: vi.fn<(...args: never[]) => Promise<void>>(() => Promise.resolve()),
    reactionShortcodes: vi.fn<(...args: never[]) => Promise<unknown[]>>(() => Promise.resolve([])),
    subscribeEvents: vi.fn(() => () => {}),
    onProfileChanged: vi.fn(() => () => {}),
    ...overrides,
  };

  // `rpc.<domain>.<method>` is the latest explicit mock for that domain, else the stub's method
  // of that name. Assigning `rpc` layers domains on, so tests can add one without dropping the rest.
  type Methods = Record<string | symbol, unknown>;
  const layers = new Map<string | symbol, Methods[]>();
  const layer = (domains: Record<string, Methods>) => {
    for (const [name, methods] of Object.entries(domains)) {
      layers.set(name, [...(layers.get(name) ?? []), methods]);
    }
  };
  layer(defaultRpc);
  if ('rpc' in stub) layer(stub.rpc as Record<string, Methods>);
  const rpc = new Proxy(
    {},
    {
      get: (_rpc, domain) =>
        new Proxy(
          {},
          {
            get: (_domain, method) =>
              [...(layers.get(domain) ?? [])].reverse().find((methods) => method in methods)?.[
                method
              ] ?? (stub as Methods)[method],
            set: (_domain, method, value: unknown) => {
              layers.set(domain, [...(layers.get(domain) ?? []), { [method]: value }]);
              return true;
            },
          }
        ),
    }
  );
  Object.defineProperty(stub, 'rpc', { get: () => rpc, set: layer, enumerable: true });
  return Object.assign(stub, { media: stub }) as typeof stub & { media: typeof stub; rpc: StubRpc };
}

export const core = createCoreStub();

export const useCoreClient = () => core;
export const provideCoreClient = vi.fn();
