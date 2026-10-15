import type { ImagePackView } from '#src/generated/protocol';

const ORIGIN_KEYS: Record<ImagePackView['origin'], string> = {
  account: 'composer.packMine',
  room: 'common.thisRoom',
  global: 'composer.packGlobal',
  space: 'composer.packSpace',
};

export function packName(pack: ImagePackView, translate: (key: string) => string): string {
  return pack.name ?? (pack.id || translate(ORIGIN_KEYS[pack.origin]));
}
