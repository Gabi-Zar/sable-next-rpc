import { invoke, isTauri } from '@tauri-apps/api/core';

import type { CoreMedia } from '#lib/core/media.svelte.js';

export async function importPersonaAvatar(
  url: string,
  commands: Pick<CoreMedia, 'uploadMedia'>
): Promise<string> {
  if (isTauri()) return invoke<string>('import_persona_avatar', { url });

  const response = await fetch(url);
  if (!response.ok) throw new Error(`avatar responded ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return commands.uploadMedia(response.headers.get('content-type') ?? 'image/*', bytes);
}
