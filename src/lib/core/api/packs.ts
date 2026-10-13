import type { ImagePackView, Rpc } from '#src/generated/protocol';

export async function imagePackListing(
  rpc: Pick<Rpc, 'packs'>,
  roomId: string,
  cachedOnly = false
): Promise<{ packs: ImagePackView[]; complete: boolean }> {
  if (roomId === '') {
    if (cachedOnly) return { packs: [], complete: false };
    return { packs: await rpc.packs.allImagePacks(), complete: false };
  }
  return rpc.packs.imagePacks({ room_id: roomId, cached_only: cachedOnly });
}

export async function imagePacks(
  rpc: Pick<Rpc, 'packs'>,
  roomId: string,
  cachedOnly = false
): Promise<ImagePackView[]> {
  return (await imagePackListing(rpc, roomId, cachedOnly)).packs;
}
