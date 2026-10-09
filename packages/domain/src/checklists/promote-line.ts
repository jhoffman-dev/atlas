import {
  FINISHED_TASK_STATUS,
  indexedTexts,
  isBlankValue,
  TASK_KEYS,
  TASK_TYPE,
  type GtdStatus,
} from '../gtd/gtd-status.ts';
import { BLOCK_ANCHOR_ATTR } from '../markdown/block-anchor.ts';
import { locateFragment, nodeAt, type NodePath } from '../markdown/block-outline.ts';
import type { EditorDocument, EditorNode } from '../markdown/editor-node.ts';
import { formatWikiLink } from '../markdown/wikilink.ts';
import { FILED_UNDER_KEY, FILED_UNDER_TYPES } from '../types/para.ts';
import { cleanEntryName } from '../vault/new-note.ts';

/*
 * Promoting a checklist line to a task (P30-03): the line's words become a
 * Task of their own, which says where it came from — a link to the line —
 * and is filed under the project the line was in; the line becomes a link to
 * the task. What is written where is decided here; reading and writing the
 * files is the application's.
 */

/** What `[[`, `]]`, `#`, `^` and `|` mean inside a link: a task named with one could not be linked. */
const LINK_SYNTAX = /[#^[\]|]/g;

/**
 * The name a promoted line's task is given: its words, made a name a file
 * and a link can both hold. Empty when nothing usable is left.
 */
export function promotedTaskName(text: string): string {
  return cleanEntryName(text.replace(LINK_SYNTAX, ' '));
}

type Properties = Readonly<Record<string, unknown>>;

/**
 * The status a promoted line's task starts in: the one a captured task
 * starts in — or, for a ticked line, which is done, Archive, which the task
 * rules date. Null in a vault still on statuses of its own, which keeps them.
 */
export function promotedTaskStatus({
  captured,
  done,
}: {
  /** What a captured task starts as (`capturedTaskStatus`). */
  captured: GtdStatus | null;
  done: boolean;
}): GtdStatus | null {
  if (captured === null) return null;
  return done ? FINISHED_TASK_STATUS : captured;
}

/**
 * The project a promoted line's task is filed under: the note the line is in,
 * when that note is a project or an area itself; else whatever that note is
 * filed under, as it writes it; else none.
 */
export function inheritedProject({
  properties,
  linkToSource,
}: {
  /** The frontmatter of the note the line is in. */
  properties: Properties;
  /** What a link to that note is written with, inside `[[…]]`. */
  linkToSource: string;
}): unknown {
  const types = indexedTexts(properties['type']);
  if (types.some((type) => FILED_UNDER_TYPES.includes(type))) {
    return formatWikiLink({ target: linkToSource, heading: null, alias: null });
  }
  const filed = properties[FILED_UNDER_KEY];
  return isBlankValue(filed) ? null : filed;
}

/**
 * The frontmatter a promoted line's task starts with: a task, in `status`
 * when the vault's Task type has one to start in, whose source is a link to
 * the line, filed under the project it inherits.
 */
export function promotedTaskProperties({
  status,
  linkToSource,
  blockId,
  project,
}: {
  /** The status a new task starts in (`capturedTaskStatus`), or null to leave it unset. */
  status: string | null;
  linkToSource: string;
  /** The id the line carries, which the source link names. */
  blockId: string;
  project: unknown;
}): Record<string, unknown> {
  return {
    type: TASK_TYPE,
    ...(status !== null && { [TASK_KEYS.status]: status }),
    [TASK_KEYS.source]: formatWikiLink({
      target: linkToSource,
      heading: `#^${blockId}`,
      alias: null,
    }),
    ...(project !== null && { [FILED_UNDER_KEY]: project }),
  };
}

/**
 * The id the line at `at` carries, when that id names it — an id an earlier
 * block also holds names that one (`locateFragment`), and the line is then
 * given one of its own — else null.
 */
export function lineBlockId(doc: EditorDocument, at: NodePath): string | null {
  const id = nodeAt(doc, at).attrs?.[BLOCK_ANCHOR_ATTR];
  if (typeof id !== 'string' || id === '') return null;
  const named = locateFragment(doc, { kind: 'block', id });
  const same = named?.length === at.length && named.every((step, index) => step === at[index]);
  return same ? id : null;
}

/**
 * The document with the checklist line at `at` made a link to its task: the
 * box stays as it is ticked, and so do the lines nested under it; the words
 * of the line itself are the link, and the line carries `blockId`, which the
 * task's source names. Null when `at` is not a checklist line.
 */
export function withPromotedLine(
  doc: EditorDocument,
  { at, blockId, linkToTask }: { at: NodePath; blockId: string; linkToTask: string },
): EditorDocument | null {
  const [first, ...rest] = at;
  const block = first === undefined ? undefined : doc.content[first];
  if (block === undefined) return null;
  const promoted = promotedIn(block, rest, { blockId, linkToTask });
  if (promoted === null) return null;
  return { ...doc, content: doc.content.map((node, index) => (index === first ? promoted : node)) };
}

function promotedIn(
  node: EditorNode,
  path: NodePath,
  line: { blockId: string; linkToTask: string },
): EditorNode | null {
  const [first, ...rest] = path;
  if (first === undefined) return node.type === 'taskItem' ? promotedItem(node, line) : null;
  const child = node.content?.[first];
  if (child === undefined) return null;
  const promoted = promotedIn(child, rest, line);
  if (promoted === null) return null;
  return {
    ...node,
    content: (node.content ?? []).map((held, index) => (index === first ? promoted : held)),
  };
}

function promotedItem(
  item: EditorNode,
  { blockId, linkToTask }: { blockId: string; linkToTask: string },
): EditorNode {
  const [own, ...nested] = item.content ?? [];
  const link: EditorNode = {
    type: 'wikiLink',
    attrs: { target: linkToTask, heading: null, alias: null },
  };
  const paragraph: EditorNode = {
    ...(own?.type === 'paragraph' ? own : { type: 'paragraph' }),
    content: [link],
  };
  return {
    ...item,
    attrs: { ...item.attrs, [BLOCK_ANCHOR_ATTR]: blockId },
    content: [paragraph, ...(own?.type === 'paragraph' ? nested : (item.content ?? []))],
  };
}
