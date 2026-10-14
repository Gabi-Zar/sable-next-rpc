import type { ReplyDirection } from '#lib/features/room/timeline/timeline-format.js';
import { matchesBinding } from '#lib/ui/shortcuts/binding.js';
import { effectiveShortcuts } from '#lib/ui/shortcuts/bindings.svelte.js';
import { isMacPlatform } from '#lib/ui/shortcuts/global-shortcuts.js';

const REPLY_STEPS: Partial<Record<string, ReplyDirection>> = {
  'room.replyOlder': 'older',
  'room.replyNewer': 'newer',
};

const EDIT_STEPS: Partial<Record<string, ReplyDirection>> = {
  'room.editOlder': 'older',
  'room.editNewer': 'newer',
};

function stepFor(
  steps: Partial<Record<string, ReplyDirection>>,
  event: KeyboardEvent
): ReplyDirection | undefined {
  const isMac = isMacPlatform();
  const shortcut = effectiveShortcuts().find(
    (candidate) => steps[candidate.id] && matchesBinding(candidate.binding, event, isMac)
  );
  return shortcut && steps[shortcut.id];
}

export function replyStep(event: KeyboardEvent): ReplyDirection | undefined {
  return stepFor(REPLY_STEPS, event);
}

export function editStep(event: KeyboardEvent): ReplyDirection | undefined {
  return stepFor(EDIT_STEPS, event);
}
