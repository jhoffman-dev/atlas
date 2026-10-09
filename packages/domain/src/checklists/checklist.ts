import type { NodePath } from '../markdown/block-outline.ts';
import type { EditorDocument, EditorNode } from '../markdown/editor-node.ts';
import { nodeText } from '../markdown/node-text.ts';

/*
 * A note's checklist (P30-03): its `- [ ]` and `- [x]` lines, read off the
 * editor's document, so the index, the progress bar and promoting a line to
 * a task all count the boxes the editor draws. A task's checklist is its
 * subtasks: In Progress plus a progress bar, rather than a status per step
 * (ADR-0029).
 */

/** One box in a note: ticked or not, and the words on its line. */
export interface ChecklistLine {
  /** Where its item is: the index of each child on the way down from the document. */
  readonly at: NodePath;
  readonly done: boolean;
  /** The words of its own line, spaces squeezed — not those of the lines nested under it. */
  readonly text: string;
}

/**
 * Every box in the note, in the order the file writes them: each one, then
 * those nested under it. A box in a quote or a callout counts; one inside a
 * shown block is the other note's, and is not here.
 */
export function checklistLines(doc: EditorDocument): ChecklistLine[] {
  const lines: ChecklistLine[] = [];
  const visit = (node: EditorNode, at: NodePath) => {
    if (node.type === 'taskItem') lines.push(lineOf(node, at));
    (node.content ?? []).forEach((child, index) => visit(child, [...at, index]));
  };
  doc.content.forEach((block, index) => visit(block, [index]));
  return lines;
}

function lineOf(item: EditorNode, at: NodePath): ChecklistLine {
  const first = item.content?.[0];
  const words = first === undefined ? '' : nodeText(first);
  return { at, done: item.attrs?.['checked'] === true, text: words.replace(/\s+/g, ' ').trim() };
}

/**
 * What every box is written with, wherever its line starts: `[`, a space (or
 * any blank) or an `x`, `]`. A box can follow a marker on its parent's line
 * (`- - [ ] x`) or start the line after a bare marker, so nothing about the
 * line around it is asked: when in doubt, the body is parsed.
 */
const BOX = /\[[\s xX]\]/;

/**
 * Whether a note's body may hold a box, read cheaply off its text: a body
 * that cannot need not be parsed to find none. A yes may still find none —
 * `[ ]` in prose, a box in code — but a no is never wrong.
 */
export function mayHoldChecklist(body: string): boolean {
  return BOX.test(body);
}

/**
 * How far through its checklist a note is: the share of its boxes ticked, as
 * a whole percentage rounded down, so 100 means every one is — 2 of 3 is 66,
 * never a 100 with a box still open. Null for a note with no box.
 */
export function checklistProgress(lines: readonly Pick<ChecklistLine, 'done'>[]): number | null {
  if (lines.length === 0) return null;
  const done = lines.filter((line) => line.done).length;
  return Math.floor((done * 100) / lines.length);
}
