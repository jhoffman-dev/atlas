import { findTags } from '@atlas/domain';
import type { Nodes as MdastNode } from 'mdast';

/** Text the serializer writes tags in: not a link's, whose words are left as they are. */
const LINKS: ReadonlySet<string> = new Set(['link', 'linkReference']);

const tagNames = (text: string) => findTags(text).map((tag) => tag.name);

/**
 * Whether a block reads a tag differently in its text than in its source:
 * `\#idea` or `&#35;idea` is text `#idea` to the parser, yet the note says it
 * is not a tag. The editor holds only the text, so saving that block would
 * write it back as a tag. Such a block is kept as its source instead, which
 * is what the editor already does with markdown it cannot hold faithfully.
 */
export function escapesATag(block: MdastNode, body: string): boolean {
  if (LINKS.has(block.type)) return false;
  if (block.type === 'text') {
    const start = block.position?.start.offset;
    const end = block.position?.end.offset;
    if (start === undefined || end === undefined || !block.value.includes('#')) return false;
    const read = tagNames(block.value);
    const written = tagNames(body.slice(start, end));
    return read.length !== written.length || read.some((name, at) => name !== written[at]);
  }
  return (
    'children' in block && block.children.some((child) => escapesATag(child as MdastNode, body))
  );
}
