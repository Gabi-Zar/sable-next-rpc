import { app } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { ScreenAudioListing } from '../../src/lib/platform/screen-audio-types';

export const SCREEN_AUDIO_LABEL = 'vencord-screen-share';

type Selection =
  | { kind: 'system'; exclude: string[]; workaround: boolean }
  | { kind: 'apps'; include: string[]; workaround: boolean };

type Node = Partial<Record<string, string>>;

interface PatchBay {
  list(props?: string[]): Node[];
  link(data: { include?: Node[]; exclude?: Node[]; mute?: boolean; workaround?: Node[] }): boolean;
  unmute(): void;
  unlink(): void;
}

interface Venmic {
  PatchBay: (new () => PatchBay) & { hasPipeWire(): boolean };
}

let patchBay: PatchBay | null | undefined;
let status: ScreenAudioListing['status'] = 'unavailable';
let linked = false;

function venmic(): PatchBay | null {
  if (patchBay !== undefined) return patchBay;
  patchBay = null;
  try {
    const load = createRequire(join(__dirname, 'main.cjs'));
    const { PatchBay } = load(join(__dirname, `venmic-${process.arch}.node`)) as Venmic;
    const hasPipeWirePulse = PatchBay.hasPipeWire();
    patchBay = new PatchBay();
    status = hasPipeWirePulse ? 'available' : 'pipewire-pulse-missing';
  } catch (error) {
    console.error('[sable screen audio] venmic did not load', error);
    const message = error instanceof Error ? error.message : String(error);
    status = /glibc|glibcxx|cxxabi/i.test(message) ? 'incompatible' : 'unavailable';
  }
  return patchBay;
}

function ownAudio(): Node {
  const pid = app.getAppMetrics().find((process) => process.name === 'Audio Service')?.pid;
  return { 'application.process.id': String(pid ?? -1) };
}

const SOURCE_PREFIX = 'pipewire:';
const SOURCE_PROPS = [
  'application.name',
  'application.process.id',
  'node.name',
  'media.name',
  'object.serial',
];

export function listApps(): ScreenAudioListing {
  const own = ownAudio()['application.process.id'];
  const apps = new Map<string, ScreenAudioListing['apps'][number]>();
  for (const node of venmic()?.list([]) ?? []) {
    if (node['application.process.id'] === own || node['device.id']) continue;
    if (node['media.class'] !== 'Stream/Output/Audio') continue;
    const name = node['application.name'] ?? node['node.description'] ?? node['node.name'];
    if (!name) continue;
    const props = Object.fromEntries(
      SOURCE_PROPS.flatMap((key) => (node[key] ? [[key, node[key]]] : []))
    );
    if (Object.keys(props).length === 0) continue;
    const id = SOURCE_PREFIX + JSON.stringify(props);
    const details = [node['media.name'], node['application.process.id']].filter(Boolean);
    apps.set(id, { id, label: details.length ? `${name} (${details.join(' · ')})` : name });
  }
  return { apps: [...apps.values()], status };
}

function nodesFor(names: string[]): Node[] {
  return names.map((name) => {
    if (!name.startsWith(SOURCE_PREFIX)) return { 'application.name': name };
    const value: unknown = JSON.parse(name.slice(SOURCE_PREFIX.length));
    if (typeof value !== 'object' || value === null) throw new Error('invalid audio source');
    const props = Object.fromEntries(
      SOURCE_PROPS.flatMap((key) => {
        const entry = (value as Record<string, unknown>)[key];
        return typeof entry === 'string' && entry ? [[key, entry]] : [];
      })
    );
    if (Object.keys(props).length === 0) throw new Error('invalid audio source');
    return props;
  });
}

function parse(value: unknown): Selection | null {
  if (typeof value !== 'object' || value === null) return null;
  const selection = value as Record<string, unknown>;
  const names = (list: unknown) =>
    Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : [];
  const workaround = selection.workaround === true;
  if (selection.kind === 'system')
    return { kind: 'system', exclude: names(selection.exclude), workaround };
  if (selection.kind === 'apps')
    return { kind: 'apps', include: names(selection.include), workaround };
  return null;
}

export function start(value: unknown): string {
  const selection = parse(value);
  const bay = venmic();
  if (!selection || !bay) throw new Error('screen audio is unavailable');

  const exclude = [ownAudio(), { 'media.class': 'Stream/Input/Audio' }];
  if (selection.kind === 'apps' && selection.include.length === 0) {
    throw new Error('no audio source selected');
  }
  const workaround = selection.workaround ? [{ ...ownAudio(), 'media.name': 'RecordStream' }] : [];
  linked = bay.link(
    selection.kind === 'system'
      ? { exclude: [...exclude, ...nodesFor(selection.exclude)], mute: true, workaround }
      : { include: nodesFor(selection.include), exclude, mute: true, workaround }
  );
  if (!linked) {
    bay.unlink();
    throw new Error('screen audio could not be linked');
  }
  return SCREEN_AUDIO_LABEL;
}

export function stop(): void {
  linked = false;
  patchBay?.unlink();
}

export function unmute(): void {
  if (linked) patchBay?.unmute();
}
