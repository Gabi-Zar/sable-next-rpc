import { afterEach, beforeEach, expect, test, vi } from 'vitest';

let currentDeepLinks: typeof import('./deep-links').currentDeepLinks;
let deliversDeepLinks: typeof import('./deep-links').deliversDeepLinks;
let subscribeDeepLinks: typeof import('./deep-links').subscribeDeepLinks;

beforeEach(async () => {
  vi.resetModules();
  ({ currentDeepLinks, deliversDeepLinks, subscribeDeepLinks } = await import('./deep-links'));
});
import type { ElectronBridge } from './electron';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubElectron(launchLinks: string[]): (urls: string[]) => void {
  let deliver: (urls: string[]) => void = () => {};
  vi.stubGlobal('sableElectron', {
    takeDeepLinks: () => Promise.resolve(launchLinks.splice(0)),
    onDeepLinks: (callback) => {
      deliver = callback;
      return () => {
        deliver = () => {};
      };
    },
  } satisfies Pick<ElectronBridge, 'takeDeepLinks' | 'onDeepLinks'>);
  return (urls) => {
    deliver(urls);
  };
}

test('a browser page delivers no deep links', async () => {
  expect(deliversDeepLinks()).toBe(false);
  expect(await currentDeepLinks()).toEqual([]);
});

test('Electron hands over the launch links once, then forwards later ones', async () => {
  const deliver = stubElectron(['moe.sable.next:/login?state=a']);
  const received: string[][] = [];
  const unsubscribe = await subscribeDeepLinks((urls) => received.push(urls));

  expect(deliversDeepLinks()).toBe(true);
  expect(await currentDeepLinks()).toEqual(['moe.sable.next:/login?state=a']);
  expect(await currentDeepLinks()).toEqual([]);

  deliver(['moe.sable.next:/login?state=b']);
  unsubscribe();
  deliver(['moe.sable.next:/login?state=c']);
  expect(received).toEqual([['moe.sable.next:/login?state=b']]);
});

test("concurrent Matrix and login consumers retain each other's launch links", async () => {
  const matrix = 'https://matrix.to/#/!room:example.org?via=example.org';
  const login = 'moe.sable.next:/login?state=a';
  stubElectron([matrix, login]);
  const [links, callbacks] = await Promise.all([
    currentDeepLinks((url) => url.startsWith('https:')),
    currentDeepLinks((url) => url.startsWith('moe.sable.next:')),
  ]);
  expect(links).toEqual([matrix]);
  expect(callbacks).toEqual([login]);
  expect(await currentDeepLinks()).toEqual([]);
});
