import { answerBlocks, type AnswerBlockKind, type RawAnswerBlock } from './answer-blocks.ts';
import { answerInline, type AnswerInline } from './answer-inline.ts';

/**
 * Whether a block of an answer says where it came from (#37, PLAN.md §11
 * principle 3): `cited` names a note, `uncited` says something and names
 * none, and `exempt` says nothing that needs a source — a heading, a rule,
 * fenced code, or a line that only leads into the list under it.
 */
export type AnswerCitation = 'cited' | 'uncited' | 'exempt';

/** One block of an answer, read for Ask: what it is, what it says, and whether it cites. */
export interface AnswerBlock {
  readonly kind: AnswerBlockKind;
  /** A list item's marker as written (`-`, `2.`); null for every other block. */
  readonly marker: string | null;
  readonly depth: number;
  /** Inside a `>` quote, as a list there is drawn. */
  readonly quoted: boolean;
  /** What it says, in pieces. Fenced code is one code piece, as fenced; it is never read for links. */
  readonly inline: readonly AnswerInline[];
  readonly citation: AnswerCitation;
}

/** Blocks that state something, and so must cite. */
const CLAIMS: ReadonlySet<AnswerBlockKind> = new Set(['paragraph', 'item', 'quote', 'table']);

/**
 * An answer read for its citations. Each paragraph, list item, quote and
 * table must hold a wiki link (`[[Note]]`, `[[Note#^id]]`, or an embed) that
 * is not in code; a web address is not a citation, since the vault is what
 * an answer is answering from. A paragraph or item ending in `:` with a list
 * under it only introduces that list, which carries the claims, and is exempt.
 */
export function citeAnswer(answer: string): AnswerBlock[] {
  const raw = answerBlocks(answer);
  return raw.map((block, at) => {
    if (block.kind === 'code')
      return { ...shape(block), inline: [{ kind: 'code', text: block.text }], citation: 'exempt' };
    const inline = answerInline(block.text);
    return { ...shape(block), inline, citation: citationOf({ block, next: raw[at + 1], inline }) };
  });
}

/** How many of an answer's blocks say something and cite nothing. */
export function uncitedCount(blocks: readonly AnswerBlock[]): number {
  return blocks.filter((block) => block.citation === 'uncited').length;
}

function shape(block: RawAnswerBlock): Pick<AnswerBlock, 'kind' | 'marker' | 'depth' | 'quoted'> {
  return { kind: block.kind, marker: block.marker, depth: block.depth, quoted: block.quoted };
}

function citationOf({
  block,
  next,
  inline,
}: {
  block: RawAnswerBlock;
  next: RawAnswerBlock | undefined;
  inline: readonly AnswerInline[];
}): AnswerCitation {
  if (!CLAIMS.has(block.kind)) return 'exempt';
  if (inline.some((piece) => piece.kind === 'cite')) return 'cited';
  return leadsIntoList(block, next) ? 'exempt' : 'uncited';
}

/** Where one sentence ends and another begins: `.`, `!` or `?`, a closing mark or none, then space. */
const SENTENCE_END = /[.!?]["'”’)\]]*\s+\S/;

/**
 * `Three things are open:` with a list straight under it, deeper for an item.
 * One sentence only: `Mara moved the run to Friday. The steps were:` states a
 * claim before its lead-in, and that claim must cite.
 */
function leadsIntoList(block: RawAnswerBlock, next: RawAnswerBlock | undefined): boolean {
  // A quoted paragraph is a quote block: it leads into the quoted list under it alike.
  const prose = block.kind === 'paragraph' || (block.kind === 'quote' && block.quoted);
  if (!prose && block.kind !== 'item') return false;
  const text = block.text.trim();
  if (!text.endsWith(':') || next?.kind !== 'item') return false;
  if (SENTENCE_END.test(text.slice(0, -1))) return false;
  return prose || next.depth > block.depth;
}
