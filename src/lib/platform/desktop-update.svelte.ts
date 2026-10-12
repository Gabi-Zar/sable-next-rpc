import type { AvailableUpdate } from './updates.js';

export type UpdateStage =
  | { name: 'available' }
  | { name: 'downloading'; percent: number }
  | { name: 'staged' }
  | { name: 'failed'; message: string };

let update = $state<AvailableUpdate | null>(null);
let stage = $state<UpdateStage>({ name: 'available' });

export const desktopUpdate = {
  get update(): AvailableUpdate | null {
    return update;
  },
  get stage(): UpdateStage {
    return stage;
  },
};

export function setPendingUpdate(found: AvailableUpdate): void {
  if (found.version !== update?.version) stage = { name: 'available' };
  update = found;
}

export async function installPendingUpdate(): Promise<void> {
  if (!update) return;
  stage = { name: 'downloading', percent: 0 };
  try {
    await update.install((percent) => {
      stage = { name: 'downloading', percent };
    });
    stage = { name: 'staged' };
  } catch (error) {
    stage = { name: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
