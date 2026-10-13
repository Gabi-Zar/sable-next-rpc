const TABBABLE =
  'a[href], button, input, select, textarea, summary, [contenteditable=""], [contenteditable="true"], [tabindex]';

function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(':disabled')) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** Elements Tab reaches inside `root`, in DOM order (positive tabindex is not modelled). */
export function tabStops(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(isTabbable);
}

/**
 * A composite widget (toolbar, tablist, tree, listbox) is one tab stop: the arrow
 * keys move between its items, so Tab must not visit each of them.
 */
export function expectSingleTabStop(widget: Element): void {
  const stops = tabStops(widget);
  if (stops.length !== 1) {
    const names = stops.map((stop) => stop.outerHTML.slice(0, 80));
    throw new Error(
      `Expected ${widget.getAttribute('role') ?? widget.tagName} to be one tab stop, found ${String(stops.length)}:\n${names.join('\n')}`
    );
  }
}
