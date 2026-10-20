import { i18n } from '#lib/i18n.js';
import { saveUrl, savesNatively } from '#lib/platform/files.js';
import { preferences } from '#lib/settings/preferences.svelte.js';
import { toasts } from '#lib/ui/toasts.svelte.js';

export async function downloadUrl(url: string, filename: string): Promise<void> {
  const outcome = await saveUrl(url, filename, preferences.askDownloadLocation);
  if (!savesNatively()) return;
  if (outcome === 'saved') toasts.info(i18n.t('viewer.saved'));
  if (outcome === 'failed') toasts.error(i18n.t('errors.actionFailed'));
}
