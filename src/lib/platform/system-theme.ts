import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type as osType } from '@tauri-apps/plugin-os';
import { MediaQuery, createSubscriber } from 'svelte/reactivity';

type Scheme = 'dark' | 'light' | null;

const media = new MediaQuery('(prefers-color-scheme: dark)');
let portal: Scheme = null;

const subscribe = createSubscriber((update) => {
  if (!isTauri() || osType() !== 'linux') return;

  let stopped = false;
  let heard = false;
  let unlisten = (): void => {};
  const set = (scheme: Scheme): void => {
    portal = scheme;
    update();
  };
  void listen<Scheme>('sable://color-scheme', (event) => {
    heard = true;
    set(event.payload);
  })
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(() => {});
  void invoke<Scheme>('system_color_scheme')
    .then((scheme) => {
      if (!stopped && !heard) set(scheme);
    })
    .catch(() => {});

  return () => {
    stopped = true;
    portal = null;
    unlisten();
  };
});

export const systemDark = {
  get current(): boolean {
    subscribe();
    return portal === null ? media.current : portal === 'dark';
  },
};
