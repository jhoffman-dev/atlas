import { EMBEDDABLE_IMAGE_EXTENSIONS } from '../attachments/image-file.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import type { HighlightColor, HighlightStyle } from './anchor.ts';
import type { HighlightBlock } from './highlight-block.ts';
import { plainQuote } from './highlight-text.ts';

/*
 * A highlight as the editor draws it (#523): the quote as a quote, in its
 * mark's colour, and the comment below it. The marker is never drawn — it is
 * where the highlight is in its file, which a reader shows and a note does
 * not — and neither is the `^id`, which the block carries as every block does
 * (ADR-0022).
 */

/** What a highlight block shows. */
export interface HighlightView {
  readonly id: string;
  /** The quote's words as they read, its escapes taken off; empty for an area's picture alone. */
  readonly words: string;
  /** The picture an area highlight's quote embeds (`![[…png]]`, ADR-0043 §3), as written; null for words. */
  readonly picture: string | null;
  /**
   * The comment exactly as the file holds it, its `%\%` and `\<` escapes
   * visible (#534). Shown with them taken off, a person's own `%\%` would read
   * as `%%`, and a later edit could change which `%%` Obsidian hides; as
   * written, a comment saved as it reads is the same bytes (`commentLines`
   * escapes only a new unbalanced `%%`).
   */
  readonly comment: string;
  readonly mark: HighlightStyle['mark'];
  readonly color: HighlightColor;
}

/** How highlight `block` is drawn. */
export function highlightView(block: HighlightBlock): HighlightView {
  const [first = '', ...rest] = block.quote.split('\n');
  const picture = pictureOf(first);
  const words = picture === null ? block.quote : rest.join('\n');
  return {
    id: block.id,
    words: plainQuote(words).trim(),
    picture,
    comment: block.comment,
    mark: block.style.mark,
    color: block.style.color,
  };
}

/** The image a quote line embeds and nothing else — `![[attachments/p4 area.png]]` — or null. */
function pictureOf(line: string): string | null {
  const link = readWikiLink(line.trim());
  if (link === null || !link.embed || link.heading !== null) return null;
  const extension = /\.([a-z0-9]+)$/i.exec(link.target)?.[1]?.toLowerCase();
  return extension !== undefined && EMBEDDABLE_IMAGE_EXTENSIONS.includes(extension)
    ? link.target
    : null;
}
