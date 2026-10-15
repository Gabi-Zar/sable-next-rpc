export interface SedEdit {
  find: string;
  replacement: string;
}

const SED = /^s\/((?:[^/\\\n]|\\.)+)\/((?:[^/\\\n]|\\.)*)\/?$/;

function unescapeSlash(part: string): string {
  return part.replaceAll('\\/', '/');
}

/** `s/find/replace`, the way Discord reads it: plain text, first match only. */
export function parseSed(text: string): SedEdit | null {
  const match = SED.exec(text.trim());
  if (!match) return null;
  return { find: unescapeSlash(match[1]), replacement: unescapeSlash(match[2]) };
}

/** The body after the edit, or `null` when `find` is not in it. */
export function applySed(body: string, { find, replacement }: SedEdit): string | null {
  const at = body.indexOf(find);
  if (at === -1) return null;
  return body.slice(0, at) + replacement + body.slice(at + find.length);
}
