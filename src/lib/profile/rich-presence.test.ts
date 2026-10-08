import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { ProfileFieldView } from '#src/generated/protocol';

import {
  activePresences,
  ExpiryTimer,
  formatClock,
  isRichPresenceField,
  nextExpiry,
  openableButtons,
  parseRichPresences,
  presenceSpan,
  progressFraction,
  summarizePresence,
} from './rich-presence';

const NOW = 1_800_000_000_000;

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function field(key: string, value: unknown): ProfileFieldView[] {
  return [{ key, value: JSON.stringify(value) }];
}

const activity = {
  id: 'a1',
  type: 'm.rpc.activity',
  expiry: NOW + 60_000,
  name: 'Minecraft',
  state: 'Playing on a server',
  details: 'Overworld',
  since: NOW - 120_000,
  large_icon_url: 'mxc://example.com/large',
};

test('reads the stable field and the activity it holds', () => {
  const [presence] = parseRichPresences(field('m.rpc', [activity]), NOW);
  expect(presence).toMatchObject({
    kind: 'activity',
    id: 'a1',
    name: 'Minecraft',
    state: 'Playing on a server',
    details: 'Overworld',
    since: NOW - 120_000,
    until: null,
    largeIcon: { url: 'mxc://example.com/large', tooltip: null },
    smallIcon: null,
  });
});

test('reads the unstable field with unstable type identifiers', () => {
  const prefix = 'xyz.extera.msc4544.rpc';
  const presences = parseRichPresences(
    field(prefix, [
      { ...activity, type: `${prefix}.activity` },
      { id: 'm1', type: `${prefix}.music`, expiry: NOW + 1000, track: 'Hated by Life' },
    ]),
    NOW
  );
  expect(presences.map((presence) => presence.kind)).toEqual(['activity', 'music']);
});

test('the unstable field wins over the stable one on duplicate ids', () => {
  const extra: ProfileFieldView[] = [
    { key: 'm.rpc', value: JSON.stringify([{ ...activity, name: 'Stable' }]) },
    {
      key: 'xyz.extera.msc4544.rpc',
      value: JSON.stringify([
        { ...activity, type: 'xyz.extera.msc4544.rpc.activity', name: 'Unstable' },
      ]),
    },
  ];
  const presences = parseRichPresences(extra, NOW);
  expect(presences).toHaveLength(1);
  expect(presences[0]).toMatchObject({ name: 'Unstable' });
});

test('entries past their expiry are never returned', () => {
  const stale = { ...activity, id: 'old', expiry: NOW - 1 };
  const exact = { ...activity, id: 'edge', expiry: NOW };
  expect(
    parseRichPresences(field('m.rpc', [stale, exact, activity]), NOW).map((p) => p.id)
  ).toEqual(['a1']);
});

test('entries missing a required field or of an unknown type are ignored', () => {
  const broken = [
    { ...activity, id: undefined },
    { ...activity, expiry: undefined },
    { ...activity, expiry: 'soon' },
    { ...activity, name: '  ' },
    { ...activity, type: 'm.rpc.unknown' },
    { id: 'm', type: 'm.rpc.music', expiry: NOW + 1 },
    'text',
    null,
  ];
  expect(parseRichPresences(field('m.rpc', broken), NOW)).toEqual([]);
});

test('anything that is not a JSON array is ignored', () => {
  expect(parseRichPresences([{ key: 'm.rpc', value: 'not json' }], NOW)).toEqual([]);
  expect(parseRichPresences(field('m.rpc', { id: 'a1' }), NOW)).toEqual([]);
  expect(parseRichPresences(undefined, NOW)).toEqual([]);
  expect(parseRichPresences([], NOW)).toEqual([]);
});

test('at most four presences are kept', () => {
  const many = Array.from({ length: 6 }, (_, index) => ({ ...activity, id: `a${index}` }));
  expect(parseRichPresences(field('m.rpc', many), NOW)).toHaveLength(4);
});

test('the small icon and tooltips need the large icon', () => {
  const withoutLarge = {
    ...activity,
    large_icon_url: undefined,
    small_icon_url: 'mxc://example.com/small',
    small_icon_tooltip: 'Away',
    large_icon_tooltip: 'Map',
  };
  expect(parseRichPresences(field('m.rpc', [withoutLarge]), NOW)[0]).toMatchObject({
    largeIcon: null,
    smallIcon: null,
  });

  const withBoth = {
    ...activity,
    small_icon_url: 'mxc://example.com/small',
    small_icon_tooltip: 'Away',
    large_icon_tooltip: 'Map',
  };
  expect(parseRichPresences(field('m.rpc', [withBoth]), NOW)[0]).toMatchObject({
    largeIcon: { tooltip: 'Map' },
    smallIcon: { url: 'mxc://example.com/small', tooltip: 'Away' },
  });
});

test('icons must be mxc urls', () => {
  const remote = { ...activity, large_icon_url: 'https://tracker.example/pixel.png' };
  expect(parseRichPresences(field('m.rpc', [remote]), NOW)[0]).toMatchObject({ largeIcon: null });
});

test('music keeps both ends of its progress or none of it', () => {
  const track = { id: 'm1', type: 'm.rpc.music', expiry: NOW + 1000, track: 'Song' };
  const parse = (extra: object) =>
    parseRichPresences(field('m.rpc', [{ ...track, ...extra }]), NOW)[0];

  expect(parse({ progress: { since: NOW - 10, until: NOW + 90 } })).toMatchObject({
    progress: { since: NOW - 10, until: NOW + 90 },
  });
  expect(parse({ progress: { since: NOW - 10 } })).toMatchObject({ progress: null });
  expect(parse({ progress: { since: NOW, until: NOW - 5 } })).toMatchObject({ progress: null });
  expect(parse({})).toMatchObject({ progress: null });
});

test('music fields are read', () => {
  const [presence] = parseRichPresences(
    field('m.rpc', [
      {
        id: 'm1',
        type: 'm.rpc.music',
        expiry: NOW + 1000,
        track: 'Hated by Life',
        artist: 'Iori Kanzaki',
        album: 'Album',
        player_name: 'YouTube Music',
        cover_url: 'mxc://example.com/cover',
      },
    ]),
    NOW
  );
  expect(presence).toMatchObject({
    kind: 'music',
    track: 'Hated by Life',
    artist: 'Iori Kanzaki',
    album: 'Album',
    playerName: 'YouTube Music',
    coverUrl: 'mxc://example.com/cover',
  });
});

test('long text is cut and at most three buttons are read', () => {
  const buttons = Array.from({ length: 5 }, (_, index) => ({
    label: `b${index}`,
    url: `https://example.com/${index}`,
  }));
  const [presence] = parseRichPresences(
    field('m.rpc', [{ ...activity, name: 'x'.repeat(500), buttons }]),
    NOW
  );
  expect(presence.kind === 'activity' && presence.name).toHaveLength(200);
  expect(presence.buttons).toHaveLength(3);
});

test('only plain web links can be opened, and openid buttons are left out', () => {
  const [presence] = parseRichPresences(
    field('m.rpc', [
      {
        ...activity,
        buttons: [
          { label: 'Web', url: 'https://example.com/join' },
          { label: 'Plain http', url: 'http://example.com/join' },
          { label: 'Script', url: 'javascript:alert(1)' },
          { label: 'Data', url: 'data:text/html,hi' },
          { label: 'Matrix', url: 'matrix:u/someone:example.com' },
          { label: 'Not a url', url: 'example' },
          {
            label: 'OpenID',
            url: 'https://game.example/join?m={openid_data}',
            request_openid: true,
          },
          { label: 'Stray placeholder', url: 'https://game.example/join?m={openid_data}' },
        ],
      },
    ]),
    NOW
  );
  // Only the first three buttons are read at all.
  expect(presence.buttons.map((button) => button.label)).toEqual(['Web', 'Plain http', 'Script']);
  expect(openableButtons(presence).map((button) => button.label)).toEqual(['Web', 'Plain http']);

  const later = defined(
    parseRichPresences(
      field('m.rpc', [
        {
          ...activity,
          buttons: [
            {
              label: 'OpenID',
              url: 'https://game.example/join?m={openid_data}',
              request_openid: true,
            },
            { label: 'Stray placeholder', url: 'https://game.example/join?m={openid_data}' },
            { label: 'Fine', url: 'https://example.com' },
          ],
        },
      ]),
      NOW
    ).at(0)
  );
  expect(later.buttons[0]?.requestOpenid).toBe(true);
  expect(openableButtons(later).map((button) => button.label)).toEqual(['Fine']);
});

test('nextExpiry and activePresences follow the clock', () => {
  const presences = parseRichPresences(
    field('m.rpc', [
      { ...activity, id: 'late', expiry: NOW + 90_000 },
      { ...activity, id: 'soon', expiry: NOW + 5_000 },
    ]),
    NOW
  );
  expect(nextExpiry(presences)).toBe(NOW + 5_000);
  expect(nextExpiry([])).toBeNull();
  expect(activePresences(presences, NOW + 5_000).map((p) => p.id)).toEqual(['late']);
});

test('formats clocks as m:ss or h:mm:ss', () => {
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(65_000)).toBe('1:05');
  expect(formatClock(3_725_000)).toBe('1:02:05');
  expect(formatClock(-5_000)).toBe('0:00');
});

test('progress is clamped to the span and empty spans have none', () => {
  expect(progressFraction(0, 100, 50)).toBe(0.5);
  expect(progressFraction(0, 100, -10)).toBe(0);
  expect(progressFraction(0, 100, 500)).toBe(1);
  expect(progressFraction(100, 100, 100)).toBeNull();
});

test('an activity has a span only with both since and until', () => {
  const parse = (extra: object) =>
    defined(parseRichPresences(field('m.rpc', [{ ...activity, ...extra }]), NOW)[0]);
  expect(presenceSpan(parse({ until: NOW + 10_000 }))).toEqual({
    since: NOW - 120_000,
    until: NOW + 10_000,
  });
  expect(presenceSpan(parse({}))).toBeNull();
});

test('summaries join the secondary lines', () => {
  const [one, two] = parseRichPresences(
    field('m.rpc', [
      activity,
      { id: 'm', type: 'm.rpc.music', expiry: NOW + 1, track: 'Song', artist: 'Band', album: 'LP' },
    ]),
    NOW
  );
  expect(summarizePresence(defined(one))).toEqual({
    title: 'Minecraft',
    subtitle: 'Playing on a server · Overworld',
  });
  expect(summarizePresence(defined(two))).toEqual({ title: 'Song', subtitle: 'Band · LP' });
});

test('knows which profile keys are rich presence fields', () => {
  expect(isRichPresenceField('m.rpc')).toBe(true);
  expect(isRichPresenceField('xyz.extera.msc4544.rpc')).toBe(true);
  expect(isRichPresenceField('m.status')).toBe(false);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

test('the expiry timer fires just after the expiry', () => {
  const timer = new ExpiryTimer();
  const due = vi.fn();
  timer.arm(NOW + 10_000, due);
  vi.advanceTimersByTime(9_999);
  expect(due).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1_000);
  expect(due).toHaveBeenCalledOnce();
});

test('arming again replaces the previous timer and clearing cancels it', () => {
  const timer = new ExpiryTimer();
  const first = vi.fn();
  const second = vi.fn();
  timer.arm(NOW + 1_000, first);
  timer.arm(NOW + 2_000, second);
  vi.advanceTimersByTime(3_000);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();

  const cancelled = vi.fn();
  timer.arm(NOW + 10_000, cancelled);
  timer.clear();
  vi.advanceTimersByTime(60_000);
  expect(cancelled).not.toHaveBeenCalled();
});

test('a null expiry arms nothing', () => {
  const timer = new ExpiryTimer();
  const due = vi.fn();
  timer.arm(null, due);
  vi.advanceTimersByTime(60_000);
  expect(due).not.toHaveBeenCalled();
});

test('a far expiry is awaited in slices and fires only once it has passed', () => {
  const timer = new ExpiryTimer();
  const due = vi.fn();
  const expiry = NOW + 30 * 24 * 60 * 60 * 1000;
  timer.arm(expiry, due);
  vi.advanceTimersByTime(29 * 24 * 60 * 60 * 1000);
  expect(due).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
  expect(due).toHaveBeenCalledOnce();
});
