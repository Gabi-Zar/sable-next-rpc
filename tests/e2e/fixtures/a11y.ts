import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

/** Elements Tab reaches inside `region`, as short descriptions. */
export function tabStops(region: Locator): Promise<string[]> {
  return region.evaluate((root) =>
    [
      ...root.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]'
      ),
    ]
      .filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(':disabled') &&
          element.checkVisibility({ visibilityProperty: true })
      )
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 40)}"`
      )
  );
}
