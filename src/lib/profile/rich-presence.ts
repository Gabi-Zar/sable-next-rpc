import type { ProfileFieldView } from '#src/generated/protocol';

/**
 * MSC4544 rich presences (display side only).
 *
 * While the MSC is unstable, `m.rpc` is replaced by `xyz.extera.msc4544.rpc` in field names and in
 * type identifiers. Both spellings are read; the unstable one is listed first so it wins on
 * duplicate presence ids.
 */
export const RICH_PRESENCE_FIELDS = ['xyz.extera.msc4544.rpc', 'm.rpc'] as const;

/** A profile can hold at most 4 presences, and a presence at most 3 buttons. */
export const MAX_RICH_PRESENCES = 4;
export const MAX_RICH_PRESENCE_BUTTONS = 3;

/** Rooms with fewer joined members than this show rich presences in their member list. */
export const RICH_PRESENCE_SMALL_ROOM_LIMIT = 10;

const MAX_TEXT_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_MXC_LENGTH = 512;
const OPENID_PLACEHOLDER = '{openid_data}';
const MAX_TIMER_DELAY_MS = 5 * 60 * 1000;
const EXPIRY_GRACE_MS = 500;

export interface RichPresenceButton {
  label: string;
  url: string;
  requestOpenid: boolean;
}

export interface RichPresenceIcon {
  url: string;
  tooltip: string | null;
}

interface RichPresenceBase {
  id: string;
  expiry: number;
  buttons: RichPresenceButton[];
}

export interface ActivityPresence extends RichPresenceBase {
  kind: 'activity';
  name: string;
  state: string | null;
  details: string | null;
  since: number | null;
  until: number | null;
  largeIcon: RichPresenceIcon | null;
  smallIcon: RichPresenceIcon | null;
}

export interface MusicPresence extends RichPresenceBase {
  kind: 'music';
  track: string;
  artist: string | null;
  album: string | null;
  playerName: string | null;
  coverUrl: string | null;
  progress: { since: number; until: number } | null;
}

export type RichPresence = ActivityPresence | MusicPresence;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function mxc(value: unknown): string | null {
  const url = text(value, MAX_MXC_LENGTH + 1);
  return url !== null && url.length <= MAX_MXC_LENGTH && url.startsWith('mxc://') ? url : null;
}

function icon(url: unknown, tooltip: unknown): RichPresenceIcon | null {
  const source = mxc(url);
  return source === null ? null : { url: source, tooltip: text(tooltip) };
}

/** Only plain web links can be opened; anything else (javascript:, data:, matrix:) is dropped. */
export function isOpenableUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function parseButtons(value: unknown): RichPresenceButton[] {
  if (!Array.isArray(value)) return [];
  const buttons: RichPresenceButton[] = [];
  for (const entry of value.slice(0, MAX_RICH_PRESENCE_BUTTONS)) {
    if (!isObject(entry)) continue;
    const label = text(entry.label);
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    if (label === null || url === '') continue;
    buttons.push({ label, url, requestOpenid: entry.request_openid === true });
  }
  return buttons;
}

/**
 * Buttons this client can act on. Buttons that need an OpenID token are not supported (this client
 * never requests one), and a link that still carries the `{openid_data}` placeholder cannot be
 * resolved, so both are left out rather than opened half-built.
 */
export function openableButtons(presence: RichPresence): RichPresenceButton[] {
  return presence.buttons.filter(
    (button) =>
      !button.requestOpenid && !button.url.includes(OPENID_PLACEHOLDER) && isOpenableUrl(button.url)
  );
}

function presenceKind(value: unknown): 'activity' | 'music' | null {
  if (typeof value !== 'string') return null;
  for (const prefix of RICH_PRESENCE_FIELDS) {
    if (value === `${prefix}.activity`) return 'activity';
    if (value === `${prefix}.music`) return 'music';
  }
  return null;
}

function parseEntry(entry: unknown): RichPresence | null {
  if (!isObject(entry)) return null;
  const kind = presenceKind(entry.type);
  const id = text(entry.id);
  const expiry = timestamp(entry.expiry);
  if (kind === null || id === null || expiry === null) return null;
  const base = { id, expiry, buttons: parseButtons(entry.buttons) };

  if (kind === 'activity') {
    const name = text(entry.name);
    if (name === null) return null;
    // The small icon and both tooltips only mean something next to a large icon.
    const largeIcon = icon(entry.large_icon_url, entry.large_icon_tooltip);
    const smallIcon =
      largeIcon === null ? null : icon(entry.small_icon_url, entry.small_icon_tooltip);
    return {
      ...base,
      kind,
      name,
      state: text(entry.state),
      details: text(entry.details),
      since: timestamp(entry.since),
      until: timestamp(entry.until),
      largeIcon,
      smallIcon,
    };
  }

  const track = text(entry.track);
  if (track === null) return null;
  // Both ends of the progress, or none of it.
  let progress: MusicPresence['progress'] = null;
  if (isObject(entry.progress)) {
    const since = timestamp(entry.progress.since);
    const until = timestamp(entry.progress.until);
    if (since !== null && until !== null && until > since) progress = { since, until };
  }
  return {
    ...base,
    kind,
    track,
    artist: text(entry.artist),
    album: text(entry.album),
    playerName: text(entry.player_name),
    coverUrl: mxc(entry.cover_url),
    progress,
  };
}

function parseField(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Presences carried by a profile's extra fields. Entries past their `expiry` are stale and are
 * never returned: the spec forbids displaying them.
 */
export function parseRichPresences(
  extra: readonly ProfileFieldView[] | null | undefined,
  now: number = Date.now()
): RichPresence[] {
  if (!extra || extra.length === 0) return [];
  const seen = new Set<string>();
  const presences: RichPresence[] = [];
  for (const key of RICH_PRESENCE_FIELDS) {
    const field = extra.find((entry) => entry.key === key);
    if (!field) continue;
    const parsed = parseField(field.value);
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      const presence = parseEntry(entry);
      if (presence === null || presence.expiry <= now || seen.has(presence.id)) continue;
      seen.add(presence.id);
      presences.push(presence);
    }
  }
  return presences.slice(0, MAX_RICH_PRESENCES);
}

/** Whether a profile field key is one of the rich presence fields. */
export function isRichPresenceField(key: string): boolean {
  return (RICH_PRESENCE_FIELDS as readonly string[]).includes(key);
}

/** The earliest `expiry` among the presences, or null when there are none. */
export function nextExpiry(presences: readonly RichPresence[]): number | null {
  let earliest: number | null = null;
  for (const presence of presences) {
    if (earliest === null || presence.expiry < earliest) earliest = presence.expiry;
  }
  return earliest;
}

/** Drops the presences that have expired by `now`. */
export function activePresences(presences: readonly RichPresence[], now: number): RichPresence[] {
  return presences.filter((presence) => presence.expiry > now);
}

/** Whether anything in the presences changes with the clock (elapsed time, countdown, progress). */
export function isTimed(presence: RichPresence): boolean {
  return presence.kind === 'activity'
    ? presence.since !== null || presence.until !== null
    : presence.progress !== null;
}

/** `m:ss`, or `h:mm:ss` from one hour up. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** How far through `since`..`until` the clock is, as 0..1; null when the span is empty. */
export function progressFraction(since: number, until: number, now: number): number | null {
  if (until <= since) return null;
  return Math.min(1, Math.max(0, (now - since) / (until - since)));
}

/** The start and end that drive the progress bar and clocks of a presence, if it has both. */
export function presenceSpan(presence: RichPresence): { since: number; until: number } | null {
  if (presence.kind === 'music') return presence.progress;
  return presence.since !== null && presence.until !== null && presence.until > presence.since
    ? { since: presence.since, until: presence.until }
    : null;
}

/** One-line summary used in dense lists (member rows, direct messages). */
export function summarizePresence(presence: RichPresence): {
  title: string;
  subtitle: string | null;
} {
  if (presence.kind === 'music') {
    return {
      title: presence.track,
      subtitle: [presence.artist, presence.album].filter(Boolean).join(' · ') || null,
    };
  }
  return {
    title: presence.name,
    subtitle: [presence.state, presence.details].filter(Boolean).join(' · ') || null,
  };
}

/**
 * Re-arms a single timer on the nearest `expiry`. When it fires, `onDue` is called so the caller
 * can drop the stale entries and re-fetch the profile for a successor.
 *
 * Long waits are re-checked in slices, because a timeout beyond ~24 days overflows and would fire
 * immediately.
 */
export class ExpiryTimer {
  #handle: ReturnType<typeof setTimeout> | null = null;

  arm(expiry: number | null, onDue: () => void): void {
    this.clear();
    if (expiry === null) return;
    const wait = Math.min(Math.max(0, expiry - Date.now()) + EXPIRY_GRACE_MS, MAX_TIMER_DELAY_MS);
    this.#handle = setTimeout(() => {
      this.#handle = null;
      if (Date.now() < expiry) this.arm(expiry, onDue);
      else onDue();
    }, wait);
  }

  clear(): void {
    if (this.#handle === null) return;
    clearTimeout(this.#handle);
    this.#handle = null;
  }
}
