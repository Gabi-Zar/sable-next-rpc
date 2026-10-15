export type RoomSort = 'recent' | 'name-asc' | 'name-desc';

export const ROOM_SORTS: readonly RoomSort[] = ['recent', 'name-asc', 'name-desc'];

export const ROOM_SORT_LABELS: Record<RoomSort, string> = {
  recent: 'nav.sortRecent',
  'name-asc': 'common.sortNameAsc',
  'name-desc': 'common.sortNameDesc',
};
