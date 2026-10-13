import type { CreateJoinRuleView, CreateRoomKind, Rpc } from '#src/generated/protocol';

export type CreateRoomOptions = {
  name?: string | null;
  topic?: string | null;
  kind?: CreateRoomKind;
  public?: boolean;
  encrypted?: boolean;
  invite?: string[];
  parentSpace?: string | null;
  alias?: string | null;
  roomVersion?: string | null;
  joinRule?: CreateJoinRuleView | null;
  federate?: boolean;
  predecessor?: string | null;
};

export function createRoom(rpc: Pick<Rpc, 'rooms'>, options: CreateRoomOptions): Promise<string> {
  return rpc.rooms.createRoom({
    name: options.name ?? null,
    topic: options.topic ?? null,
    kind: options.kind ?? 'text',
    public: options.public ?? false,
    encrypted: options.encrypted ?? true,
    invite: [...(options.invite ?? [])],
    parent_space: options.parentSpace ?? null,
    alias: options.alias ?? null,
    room_version: options.roomVersion ?? null,
    join_rule: options.joinRule ?? null,
    federate: options.federate ?? true,
    predecessor: options.predecessor ?? null,
  });
}

/** Copies `via`, so a reactive proxy cannot reach the transport. */
export function joinRoom(
  rpc: Pick<Rpc, 'rooms'>,
  address: string,
  via: readonly string[] = []
): Promise<string> {
  return rpc.rooms.joinRoom({ address, via: [...via] });
}

export function knockRoom(
  rpc: Pick<Rpc, 'rooms'>,
  address: string,
  via: readonly string[] = [],
  reason?: string
): Promise<string> {
  return rpc.rooms.knockRoom({
    address,
    via: [...via],
    reason: reason ?? null,
  });
}
