import axe from 'axe-core';

// Run in the browser project: contrast and visibility checks need real layout.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

// A component rendered alone has no page around it.
const STANDALONE_RULES_OFF = ['region', 'landmark-one-main', 'page-has-heading-one'];

export interface A11yOptions {
  /** Rule ids to skip, each with the reason it cannot apply. */
  disable?: readonly string[];
}

export async function a11yViolations(
  root: Element,
  { disable = [] }: A11yOptions = {}
): Promise<string[]> {
  const rules = Object.fromEntries(
    [...STANDALONE_RULES_OFF, ...disable].map((id) => [id, { enabled: false }])
  );
  const result = await axe.run(root, { runOnly: { type: 'tag', values: TAGS }, rules });
  return result.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id}: ${node.target.join(' ')} (${violation.helpUrl})`
    )
  );
}

export async function expectNoA11yViolations(root: Element, options?: A11yOptions): Promise<void> {
  const violations = await a11yViolations(root, options);
  if (violations.length) {
    throw new Error(`Accessibility violations:\n${violations.join('\n')}`);
  }
}
