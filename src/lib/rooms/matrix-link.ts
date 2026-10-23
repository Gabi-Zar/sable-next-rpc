import type { MatrixLink } from '#src/generated/protocol';

export type { MatrixLink };
export { parseMatrixLink } from '#lib/model/model.js';

/** matrix.to queries live inside the fragment; matrix: queries precede it. */
export function matrixLinkParameters(href: string): URLSearchParams {
  const resource = /^matrix:/i.test(href)
    ? (href.split('#', 1)[0] ?? '')
    : href.slice(href.indexOf('#') + 1);
  const query = resource.indexOf('?');
  return new URLSearchParams(query < 0 ? '' : resource.slice(query + 1).replaceAll('+', '%2B'));
}

export function matrixLinkAction(href: string, link: MatrixLink): 'join' | 'chat' | null {
  const action = matrixLinkParameters(href).get('action');
  if (action === 'join' && link.kind === 'room') return action;
  if (action === 'chat' && link.kind === 'user') return action;
  return null;
}
