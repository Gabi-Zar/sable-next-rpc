import type { Attachment } from 'svelte/attachments';

const ITEM = 'button, a[href], input, select, textarea, [role="tab"], [role="menuitem"]';

interface Options {
  orientation?: 'horizontal' | 'vertical';
  /** Elements that take part; defaults to every control inside the container. */
  selector?: string;
  /** Wrap from the last control to the first and back. */
  loop?: boolean;
}

// Where Tab lands first when nothing inside has had focus yet.
const SELECTED = '[aria-current="page"], [aria-selected="true"]';

// Arrow keys keep their text-editing meaning in these.
const EDITABLE =
  'input:not([type="radio"]):not([type="checkbox"]):not([type="button"]), textarea, select, [contenteditable="true"]';

/**
 * Makes a container one tab stop: arrows, Home and End move between its controls
 * (the WAI-ARIA toolbar pattern), and Tab leaves it. Controls added later are picked up.
 */
export function rovingFocus({
  orientation = 'horizontal',
  selector = ITEM,
  loop = false,
}: Options = {}): Attachment<HTMLElement> {
  const [previous, next] =
    orientation === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];

  return (container) => {
    let current: HTMLElement | undefined;
    let order: HTMLElement[] = [];

    const items = () =>
      [...container.querySelectorAll<HTMLElement>(selector)].filter(
        (item) => !item.matches(':disabled') && item.checkVisibility()
      );

    const sync = () => {
      const all = items();
      if (current && !all.includes(current)) {
        const focusLost = document.activeElement === document.body;
        const removedAt = Math.min(order.indexOf(current), all.length - 1);
        const replacement = all.at(removedAt);
        current = replacement;
        if (focusLost) replacement?.focus();
      }
      current ??= all.find((item) => item.matches(SELECTED)) ?? all[0];
      order = all;
      for (const item of all) item.tabIndex = item === current ? 0 : -1;
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && items().includes(target)) {
        current = target;
        sync();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!(event.target instanceof HTMLElement) || event.target.matches(EDITABLE)) return;
      const all = items();
      const index = all.indexOf(event.target);
      if (index < 0) return;
      const step = (offset: number) => {
        const at = index + offset;
        return loop ? all[(at + all.length) % all.length] : all[at];
      };
      let target: HTMLElement | undefined;
      if (event.key === next) target = step(1);
      else if (event.key === previous) target = step(-1);
      else if (event.key === 'Home') target = all[0];
      else if (event.key === 'End') target = all[all.length - 1];
      if (!target) return;
      event.preventDefault();
      target.focus();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden'],
    });
    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('keydown', onKeyDown);
    return () => {
      observer.disconnect();
      container.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('keydown', onKeyDown);
    };
  };
}
