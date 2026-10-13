import type { FieldEdit, Rpc } from '#src/generated/protocol';

export type MemberLookEdit = Partial<
  Record<'display_name' | 'avatar_url' | 'color_on_light' | 'color_on_dark', FieldEdit>
>;

const KEEP: FieldEdit = { kind: 'keep' };

export async function setMemberLook(
  rpc: Pick<Rpc, 'members'>,
  roomId: string,
  edit: MemberLookEdit,
  inParentSpace = false
): Promise<void> {
  await rpc.members.setMemberLook({
    room_id: roomId,
    in_parent_space: inParentSpace,
    display_name: edit.display_name ?? KEEP,
    avatar_url: edit.avatar_url ?? KEEP,
    color_on_light: edit.color_on_light ?? KEEP,
    color_on_dark: edit.color_on_dark ?? KEEP,
  });
}
