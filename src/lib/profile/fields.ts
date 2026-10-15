import { graphemes } from '#lib/graphemes.js';

export const PRONOUNS_FIELD = 'io.fsky.nyx.pronouns';
export const NAME_COLOR_FIELD = 'eu.she-a.color';
export const STATUS_FIELD = 'org.matrix.msc4426.status';
export const SUPPORTER_FIELD = 'moe.sable.app.supporter_awards';
export const SUPPORTER_BADGE_FIELD = 'moe.sable.app.supporter_badge';
export const BANNER_FIELD = 'chat.commet.profile_banner';
export const BIO_FIELD = 'gay.fomx.biography';
export const LEGACY_BIO_FIELDS = ['moe.sable.app.bio', 'chat.commet.profile_bio'];
export const LEGACY_STATUS_FIELDS = ['chat.commet.profile_status', 'm.status'];

export const MAX_DISPLAY_NAME_LENGTH = 255;
export const MAX_STATUS_TEXT_BYTES = 256;
export const MAX_STATUS_EMOJI_BYTES = 32;

const utf8 = new TextEncoder();

export function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const { segment } of graphemes.segment(text)) {
    bytes += utf8.encode(segment).length;
    if (bytes > maxBytes) break;
    out += segment;
  }
  return out;
}

export function statusContent(
  text: string,
  emoji: string | null | undefined
): { text: string; emoji: string } | null {
  const clamped = truncateUtf8(text, MAX_STATUS_TEXT_BYTES);
  return clamped
    ? { text: clamped, emoji: truncateUtf8(emoji ?? '', MAX_STATUS_EMOJI_BYTES) }
    : null;
}

export function legacyDeletes(present: string[], legacy: string[]): Array<[string, null]> {
  return legacy.filter((field) => present.includes(field)).map((field) => [field, null]);
}
