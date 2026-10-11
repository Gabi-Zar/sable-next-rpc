import { on } from 'svelte/events';
import { createSubscriber } from 'svelte/reactivity';

import { watchWindowFocus } from './window-decorations.js';

let nativeFocused: boolean | null = null;
let pageShown = true;
let wasActive = true;
let inactiveSince = 0;
let resumedAt = Number.NEGATIVE_INFINITY;
const RESUME_GRACE_MS = 8000;
const MIN_INACTIVE_MS = 30000;

function isActive(): boolean {
  return (
    pageShown && document.visibilityState === 'visible' && (nativeFocused ?? document.hasFocus())
  );
}

function noteActivity(): void {
  const now = isActive();
  if (now === wasActive) return;
  const at = performance.now();
  if (now && at - inactiveSince >= MIN_INACTIVE_MS) resumedAt = at;
  else if (!now) inactiveSince = at;
  wasActive = now;
}

const subscribe = createSubscriber((notify) => {
  const update = (): void => {
    noteActivity();
    notify();
  };
  let stopped = false;
  let unlisten = (): void => {};
  void watchWindowFocus((focused) => {
    if (stopped) return;
    nativeFocused = focused;
    update();
  })
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(() => {
      if (stopped) return;
      nativeFocused = null;
      update();
    });
  const hide = () => {
    pageShown = false;
    update();
  };
  const show = () => {
    pageShown = true;
    update();
  };
  const offs = [
    on(window, 'focus', update),
    on(window, 'blur', update),
    on(window, 'pagehide', hide),
    on(window, 'pageshow', show),
    on(document, 'visibilitychange', update),
    on(document, 'freeze', hide),
    on(document, 'resume', show),
  ];
  return () => {
    stopped = true;
    unlisten();
    nativeFocused = null;
    pageShown = true;
    for (const off of offs) off();
  };
});

export const windowActivity = {
  get visible(): boolean {
    subscribe();
    return pageShown && document.visibilityState === 'visible';
  },

  get active(): boolean {
    subscribe();
    return isActive();
  },

  get recentlyResumed(): boolean {
    return performance.now() - resumedAt < RESUME_GRACE_MS;
  },
};
