import { i18n } from '#lib/i18n.js';

export function redactedLabel(name: string | null, reason: string | null): string {
  if (name) {
    return reason
      ? i18n.t('timeline.redactedByWithReason', { name, reason })
      : i18n.t('timeline.redactedBy', { name });
  }
  return reason ? i18n.t('timeline.redactedWithReason', { reason }) : i18n.t('timeline.redacted');
}
