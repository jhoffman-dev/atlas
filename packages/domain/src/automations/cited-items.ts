/**
 * Every item cites its source (PLAN.md §11, ADR-0028): a note a step writes
 * from data DFAI handed it (#40, the Friday review draft) says nothing it
 * cannot point at. Each list item of the note must link, by path, a note the
 * run was given — a task, a project, a meeting. An item that links none is
 * left out and the rest kept, as a meeting's uncited action item is: the run's
 * log names each one. An answer whose every item is left out is refused, so
 * no draft is written that cites nothing.
 *
 * Only list items are held to it: a heading, or a sentence such as the
 * Inbox's count, is the draft's frame, not a claim about a note. A link in
 * code, inline or fenced, is not a citation, and nor is a link by bare title,
 * which two notes can share.
 */

import { splitWikiLinks } from '../markdown/wikilink.ts';
import type { DroppedItem } from './proposal-schema.ts';

/** A note's body with its uncited items left out, and each of them with why. */
export interface CitedBody {
  readonly body: string;
  readonly dropped: readonly DroppedItem[];
  /** How many items it kept. */
  readonly kept: number;
}

/** What the model is told, beside the note answer's own format. */
export const CITED_ITEMS_INSTRUCTIONS = [
  'Every list item must link the task, project or meeting it is about by its path, exactly as the',
  'data gives it: [[Tasks/Send the file.md]]. An item that links none of them is left out.',
  'Write a count, such as what waits in the Inbox, as a sentence, not as a list item.',
].join('\n');

export const UNCITED_REASON = 'It links no task, project or meeting this run was given.';

const ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(.*\S)\s*$/;
const THEMATIC_BREAK = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * The body with every list item that links none of `sources` left out.
 * `sources` are vault paths; a link may leave off the `.md`.
 */
export function keepCitedItems({
  body,
  sources,
}: {
  body: string;
  sources: ReadonlySet<string>;
}): CitedBody {
  const dropped: DroppedItem[] = [];
  let kept = 0;
  let fence: string | null = null;
  const lines = body.split('\n').filter((line) => {
    const opens = FENCE.exec(line)?.[1] ?? null;
    if (opens !== null && (fence === null || fence === opens)) {
      fence = fence === null ? opens : null;
      return true;
    }
    const item = fence === null && !THEMATIC_BREAK.test(line) ? ITEM.exec(line) : null;
    if (item === null) return true;
    if (citesASource(item[1]!, sources)) {
      kept += 1;
      return true;
    }
    dropped.push({ title: item[1]!, reason: UNCITED_REASON });
    return false;
  });
  return { body: lines.join('\n'), dropped, kept };
}

/** Whether the item's text links one of the sources: the editor's link grammar, which reads code as text. */
function citesASource(text: string, sources: ReadonlySet<string>): boolean {
  return splitWikiLinks(text).some(
    (piece) =>
      piece.kind === 'wikiLink' &&
      (sources.has(piece.target.trim()) || sources.has(`${piece.target.trim()}.md`)),
  );
}

/** Why an answer is refused when it had items and none of them cited a source. */
export function nothingCitedProblem(cited: CitedBody): string | null {
  return cited.kept === 0 && cited.dropped.length > 0
    ? `None of its ${cited.dropped.length} items links a task, project or meeting it was given.`
    : null;
}
