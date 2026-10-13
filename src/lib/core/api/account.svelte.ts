import type { AvatarEditView, FieldEdit, ProfileOverridesView, Rpc } from '#src/generated/protocol';

export async function setAccountData(rpc: Rpc, eventType: string, content: unknown): Promise<void> {
  await rpc.account.setAccountData({ event_type: eventType, content: $state.snapshot(content) });
}

export async function setSealedAccountData(
  rpc: Rpc,
  eventType: string,
  content: unknown
): Promise<void> {
  await rpc.account.setSealedAccountData({
    event_type: eventType,
    content: $state.snapshot(content),
  });
}

export function setProfileOverride(
  rpc: Rpc,
  userId: string,
  edit: { display_name: FieldEdit; avatar: AvatarEditView; color: FieldEdit }
): Promise<ProfileOverridesView> {
  return rpc.account.setProfileOverride({ user_id: userId, ...$state.snapshot(edit) });
}
