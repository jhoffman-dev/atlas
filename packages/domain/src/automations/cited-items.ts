/**
 * Every item cites its source (PLAN.md §11, ADR-0028): a note a step writes
 * from data DFAI handed it (#40, the Friday review draft) says nothing it
 * cannot point at. Each list item of the note must link, by path, a note the
 * run was given — a task, a project, a meeting — and every link in a kept item
 * must be one of them. An item that links none is left out, with whatever
 * hangs from it (its indented lines and children), and the rest kept, as a
 * meeting's uncited action item is; a link to a note the run was not given is
 * turned into plain text. The run's log names each one. An answer with no item
 * that cites, when it was given notes to cite, is refused: no draft is written
 * that cites nothing. Given nothing to cite — a quiet week — every item is left
 * out, since none could cite anything, and the run is not refused: the draft is
 * its frame and a line, written by DFAI and not the model, that there was
 * nothing to cite.
 *
 * Only list items are held to it — in a block quote too: a heading, or a
 * sentence such as the Inbox's count, is the draft's frame, not a claim about
 * a note. Its links are written as list items' are all the same, so no
 * source id, and no link to a note the run was not given, reaches the note.
 * A link in code, inline or fenced, is not a citation, and nor is a link by
 * bare title, which two notes can share.
 */

import { wikiLinkSpans } from '../markdown/wikilink-spans.ts';
import type { DroppedItem } from './proposal-schema.ts';

/** A note's body with its uncited items left out, and each of them with why. */
export interface CitedBody {
  readonly body: string;
  readonly dropped: readonly DroppedItem[];
  /**
   * Items kept after a link to a note the run was not given was written as
   * plain text. Each is titled by its line as written, with those links made plain.
   */
  readonly stripped: readonly DroppedItem[];
  /** How many items it kept. */
  readonly kept: number;
  /** How many notes the run was given to cite. */
  readonly offered: number;
}

/** What the model is told, beside the note answer's own format. */
export const CITED_ITEMS_INSTRUCTIONS = [
  'Every list item must link the task, project or meeting it is about, exactly as the data gives it:',
  '[[Tasks/Send the file.md]]. An item that links none of them is left out, and a link to any',
  'other note is written as plain text. Write a count, such as what waits in the Inbox, as a',
  'sentence, not as a list item.',
].join('\n');

/** What a quiet week's draft says in place of its items, added by DFAI. */
export const NOTHING_TO_CITE_LINE = 'Nothing to cite this week.';

export const UNCITED_REASON = 'It links no task, project or meeting this run was given.';

const QUOTE_PREFIX = /^(?:\s{0,3}>)+ ?/;
const ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*\S)\s*$/;
const THEMATIC_BREAK = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;

/** A line read as markdown reads it: how deep in block quotes, and what is left. */
interface Line {
  readonly prefix: string;
  readonly depth: number;
  readonly rest: string;
  readonly blank: boolean;
  /** The columns before the first character, tabs as four. */
  readonly indent: number;
}

function readLine(line: string): Line {
  const prefix = QUOTE_PREFIX.exec(line)?.[0] ?? '';
  const rest = line.slice(prefix.length);
  const spaces = /^[ \t]*/.exec(rest)![0].replace(/\t/g, '    ').length;
  return {
    prefix,
    depth: (prefix.match(/>/g) ?? []).length,
    rest,
    blank: rest.trim() === '',
    indent: spaces,
  };
}

/** What a dropped item's block is: its quote depth and the indent its lines must pass to belong to it. */
interface Block {
  readonly depth: number;
  readonly indent: number;
}

/**
 * The body with every list item that links none of `sources` left out, and a
 * link to a note that is not one of them written as the words it showed.
 * `sources` are vault paths; a link may leave off the `.md`. `plain` maps a
 * source id (one handed for a note no link can name) to the title written in
 * its place: it counts as a citation, and is written as text.
 */
export function keepCitedItems({
  body,
  sources,
  plain = new Map(),
}: {
  body: string;
  sources: ReadonlySet<string>;
  plain?: ReadonlyMap<string, string>;
}): CitedBody {
  const dropped: DroppedItem[] = [];
  const stripped: DroppedItem[] = [];
  const out: string[] = [];
  let kept = 0;
  let fence: string | null = null;
  let skipping: Block | null = null;
  /** Blank lines after a dropped item, kept only if its block ends before the next line joins it. */
  let held: string[] = [];
  let swallowedText = false;

  const rewritten = (line: Line): string => {
    const written = rewriteLinks({ text: line.rest, sources, plain });
    if (written.removed.length > 0) {
      stripped.push({
        title: ITEM.exec(written.text)?.[2] ?? written.text.trim(),
        reason: `It linked ${written.removed.join(', ')}, which this run was not given: written as plain text.`,
      });
    }
    return `${line.prefix}${written.text}`;
  };

  for (const text of body.split('\n')) {
    const line = readLine(text);
    if (skipping !== null) {
      if (line.blank) {
        held.push(text);
        continue;
      }
      const belongs =
        line.depth === skipping.depth &&
        (line.indent > skipping.indent || (held.length === 0 && swallowedText && isLazyText(line)));
      if (belongs) {
        held = [];
        swallowedText = true;
        continue;
      }
      out.push(...held);
      held = [];
      skipping = null;
    }
    const opens = FENCE.exec(line.rest)?.[1] ?? null;
    if (opens !== null && (fence === null || fence === opens)) {
      fence = fence === null ? opens : null;
      out.push(text);
      continue;
    }
    const item = fence === null && !THEMATIC_BREAK.test(line.rest) ? ITEM.exec(line.rest) : null;
    if (item === null) {
      out.push(fence === null ? rewritten(line) : text);
      continue;
    }
    const title = item[2]!;
    const cites = citesASource(line.rest, sources);
    if (cites) {
      kept += 1;
      out.push(rewritten(line));
    } else {
      dropped.push({ title, reason: UNCITED_REASON });
      skipping = { depth: line.depth, indent: item[1]!.length };
      swallowedText = false;
    }
  }
  out.push(...held);
  const quiet = sources.size === 0 && dropped.length > 0;
  const text = out.join('\n');
  return {
    body: quiet ? `${text.trimEnd()}\n\n${NOTHING_TO_CITE_LINE}\n` : text,
    dropped,
    stripped,
    kept,
    offered: sources.size,
  };
}

/** A line that a paragraph would carry on without a blank line: not a heading, a rule or a quote. */
function isLazyText(line: Line): boolean {
  return (
    !ITEM.test(line.rest) &&
    !HEADING.test(line.rest) &&
    !THEMATIC_BREAK.test(line.rest) &&
    !FENCE.test(line.rest)
  );
}

const targetOf = (target: string): string => target.trim();

/** Whether a link's target is one of the sources, with or without its extension. */
function isSource(target: string, sources: ReadonlySet<string>): boolean {
  return sources.has(targetOf(target)) || sources.has(`${targetOf(target)}.md`);
}

/** Whether the item's text links one of the sources: the editor's link grammar, which reads code as text. */
function citesASource(text: string, sources: ReadonlySet<string>): boolean {
  return wikiLinkSpans(text).some(({ link }) => isSource(link.target, sources));
}

/**
 * The text with each link to a note that is not a source written as the words
 * it showed, and each link to a source with no link of its own (`plain`) as
 * its title. `removed` names the targets that were not sources.
 */
function rewriteLinks({
  text,
  sources,
  plain,
}: {
  text: string;
  sources: ReadonlySet<string>;
  plain: ReadonlyMap<string, string>;
}): { text: string; removed: string[] } {
  const removed: string[] = [];
  let written = text;
  for (const { start, end, link } of [...wikiLinkSpans(text)].reverse()) {
    const target = targetOf(link.target);
    const title = plain.get(target);
    if (title === undefined && isSource(target, sources)) continue;
    if (title === undefined) removed.unshift(target);
    const shown = title ?? link.alias ?? titleOfTarget(target);
    written = `${written.slice(0, start)}${shown}${written.slice(end)}`;
  }
  return { text: written, removed };
}

/** A note's name as a link's reader sees it: no folder, no extension. */
function titleOfTarget(target: string): string {
  return target.replace(/^.*\//, '').replace(/\.md$/i, '');
}

/** Why an answer is refused when it was given notes to cite and none of its items did. */
export function nothingCitedProblem(cited: CitedBody): string | null {
  if (cited.kept > 0 || cited.offered === 0) return null;
  if (cited.dropped.length > 0) {
    return `None of its ${cited.dropped.length} items links a task, project or meeting it was given.`;
  }
  return 'It has no list item, so nothing in it links a task, project or meeting it was given.';
}
