import { on } from 'svelte/events';

import { holdOverlayBack } from '#lib/platform/overlay-back.svelte.js';

export function callFullscreen(element: () => HTMLElement | undefined, native: () => boolean) {
  let browserFullscreen = $state(false);
  let expanded = $state(false);
  let restore: (() => void) | undefined;

  function exit(): void {
    if (restore) {
      restore();
      restore = undefined;
      expanded = false;
    } else if (document.fullscreenElement === element()) {
      document.exitFullscreen().catch(reportError);
    }
  }

  holdOverlayBack(() => expanded, exit);

  $effect(() => {
    const target = element();
    if (!target) return;
    const offFullscreen = on(document, 'fullscreenchange', () => {
      browserFullscreen = document.fullscreenElement === target;
    });
    const offKey = on(target, 'keydown', (event) => {
      if (expanded && event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        exit();
      }
    });
    return () => {
      const wasExpanded = expanded;
      exit();
      if (wasExpanded) target.remove();
      offFullscreen();
      offKey();
    };
  });

  function toggle(): void {
    if (expanded || browserFullscreen) {
      exit();
      return;
    }
    const target = element();
    if (!target) return;
    if (!native()) {
      target.requestFullscreen().catch(reportError);
      return;
    }

    // Native video is a sibling of the WebView and cannot follow browser fullscreen.
    // Move out of layout containers so fixed positioning covers the WebView viewport.
    const marker = document.createComment('call fullscreen');
    const focused = document.activeElement;
    target.before(marker);
    document.body.append(target);
    expanded = true;
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    restore = () => {
      if (marker.parentNode) marker.replaceWith(target);
      else target.remove();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }

  return {
    get available() {
      return (
        native() ||
        (typeof document !== 'undefined' &&
          document.fullscreenEnabled &&
          typeof HTMLElement.prototype.requestFullscreen === 'function')
      );
    },
    get active() {
      return expanded || browserFullscreen;
    },
    get expanded() {
      return expanded;
    },
    toggle,
    exit,
  };
}

function reportError(error: unknown): void {
  console.warn('[sable call] could not change fullscreen', error);
}
