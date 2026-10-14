import type { PackImageView } from '#src/generated/protocol';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

import type { Suggestion } from './autocomplete';
import { composerSchema } from './editor/schema';
import { emoticonNode } from './editor/shortcodes';
import { ROOM_MENTION } from './suggestions';

export function suggestionNode(
  sigil: string,
  suggestion: Suggestion,
  emotes: readonly PackImageView[]
): ProseMirrorNode {
  if (sigil === '/' || sigil === '!') return composerSchema.text(suggestion.insert);

  if (sigil === '@') {
    if (suggestion.id === ROOM_MENTION) return composerSchema.nodes.room_ping.create();
    return composerSchema.nodes.mention.create({
      userId: suggestion.id,
      name: suggestion.insert,
    });
  }

  if (sigil === '#') {
    return composerSchema.nodes.mention.create({ userId: suggestion.id, name: suggestion.label });
  }

  const shortcode = suggestion.id.replace(/^pack:/, '');
  const image = emotes.find((candidate) => candidate.shortcode === shortcode);
  if (!image) return composerSchema.text(suggestion.insert);

  return emoticonNode(image);
}
