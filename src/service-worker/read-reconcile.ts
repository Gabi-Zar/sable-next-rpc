export function roomsToReconcile(
  notifications: readonly { data: unknown }[],
  userId: string,
  currentRoomId: string | null
): string[] {
  return [
    ...new Set(
      notifications.flatMap((notification) => {
        const data = notification.data as { roomId?: unknown; userId?: unknown } | undefined;
        return data?.userId === userId &&
          typeof data.roomId === 'string' &&
          data.roomId !== currentRoomId
          ? [data.roomId]
          : [];
      })
    ),
  ];
}
