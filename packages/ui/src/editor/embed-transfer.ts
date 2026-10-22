import { highlightEmbed } from '@dfai/domain';

/** What a dragged block carries: the embed as text for any app, and as the editor's own HTML. */
export interface EmbedTransfer {
  readonly text: string;
  readonly html: string;
}

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
};

const escaped = (value: string) =>
  value.replace(/[&"<>]/g, (each) => ATTRIBUTE_ESCAPES[each] ?? each);

/**
 * A block of `target` as a drag carries it (#507), so a drop in a note makes
 * the embed `![[target#^id]]`. The HTML is what the block embed renders and
 * parses (`BlockEmbed`'s `div[data-block-embed]`), so ProseMirror's own drop
 * parses it into the node — the editor's paste and drop path, not a new
 * one — and any other app gets the embed as text.
 */
export function blockEmbedTransfer({ target, id }: { target: string; id: string }): EmbedTransfer {
  return {
    text: highlightEmbed({ target, id }),
    html: `<div data-block-embed="${escaped(target)}" data-heading="#^${escaped(id)}"></div>`,
  };
}
