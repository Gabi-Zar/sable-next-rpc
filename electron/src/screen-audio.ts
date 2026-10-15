import { app } from 'electron';
import { join } from 'node:path';

export const SCREEN_AUDIO_LABEL = 'vencord-screen-share';

type Selection = { kind: 'system'; exclude: string[] } | { kind: 'apps'; include: string[] };

type Node = Partial<Record<string, string>>;

interface PatchBay {
  list(props?: string[]): Node[];
  link(data: { include?: Node[]; exclude?: Node[]; mute?: boolean }): boolean;
  unlink(): void;
}

interface Venmic {
  PatchBay: (new () => PatchBay) & { hasPipeWire(): boolean };
}

let patchBay: PatchBay | null | undefined;

function venmic(): PatchBay | null {
  if (patchBay !== undefined) return patchBay;
  patchBay = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PatchBay } = require(join(__dirname, `venmic-${process.arch}.node`)) as Venmic;
    if (PatchBay.hasPipeWire()) patchBay = new PatchBay();
  } catch (error) {
    console.error('[sable screen audio] venmic did not load', error);
  }
  return patchBay;
}

function ownAudio(): Node {
  const pid = app.getAppMetrics().find((process) => process.name === 'Audio Service')?.pid;
  return { 'application.process.id': String(pid ?? -1) };
}

let listed = new Map<string, Node>();

export function listApps(): string[] {
  const own = ownAudio()['application.process.id'];
  const nodes = (venmic()?.list(['application.name', 'node.name']) ?? []).filter(
    (node) => node['application.process.id'] !== own
  );
  listed = new Map(
    nodes.map((node) => [node['application.name'] ?? node['node.name'] ?? '', node] as const)
  );
  listed.delete('');
  return [...listed.keys()];
}

function nodesFor(names: string[]): Node[] {
  return names.map((name) => listed.get(name) ?? { 'application.name': name });
}

function parse(value: unknown): Selection | null {
  if (typeof value !== 'object' || value === null) return null;
  const selection = value as Record<string, unknown>;
  const names = (list: unknown) =>
    Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : [];
  if (selection.kind === 'system') return { kind: 'system', exclude: names(selection.exclude) };
  if (selection.kind === 'apps') return { kind: 'apps', include: names(selection.include) };
  return null;
}

export function start(value: unknown): string {
  const selection = parse(value);
  const bay = venmic();
  if (!selection || !bay) throw new Error('screen audio is unavailable');

  const exclude = [ownAudio(), { 'media.class': 'Stream/Input/Audio' }];
  const linked = bay.link(
    selection.kind === 'system'
      ? { exclude: [...exclude, ...nodesFor(selection.exclude)], mute: false }
      : { include: nodesFor(selection.include), exclude, mute: false }
  );
  if (!linked) throw new Error('screen audio could not be linked');
  return SCREEN_AUDIO_LABEL;
}

export function stop(): void {
  patchBay?.unlink();
}
