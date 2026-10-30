import { MediaQuery } from 'svelte/reactivity';

const media = new MediaQuery('(prefers-color-scheme: dark)');

export const systemDark = {
  get current(): boolean {
    return media.current;
  },
};
