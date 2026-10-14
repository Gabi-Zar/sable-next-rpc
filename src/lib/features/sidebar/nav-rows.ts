import type { RoomListItemView } from '#src/generated/protocol';

import type { SpaceTreeNode, Thread } from './space-tree.js';

export type RoomNavRow = {
  room?: RoomListItemView;
  roomId: string;
  parentSpaceId?: string;
  depth: number;
  kind: 'room';
  key: string;
  threads?: Thread[];
};

const roomRows = new WeakMap<RoomListItemView, RoomNavRow>();

export function roomRow(room: RoomListItemView): RoomNavRow {
  const cached = roomRows.get(room);
  if (cached) return cached;
  const row: RoomNavRow = {
    room,
    roomId: room.room_id,
    depth: 0,
    kind: 'room',
    key: room.room_id,
  };
  roomRows.set(room, row);
  return row;
}

export function byRecency(left: RoomNavRow, right: RoomNavRow): number {
  return (right.room?.latest_event?.timestamp ?? 0) - (left.room?.latest_event?.timestamp ?? 0);
}

export function isFavourite(row: RoomNavRow): boolean {
  return row.room?.tags.includes('favourite') ?? false;
}

export function treeRows(items: SpaceTreeNode[]): RoomNavRow[] {
  return items.flatMap((item) => (item.kind === 'room' ? [item] : treeRows(item.children)));
}

export function withoutFavourites(items: SpaceTreeNode[]): SpaceTreeNode[] {
  return items.flatMap<SpaceTreeNode>((item) => {
    if (item.kind === 'room') return isFavourite(item) ? [] : [item];
    if (item.kind === 'link') return [item];
    const children = withoutFavourites(item.children);
    return children.length === 0 ? [] : [{ ...item, children }];
  });
}
