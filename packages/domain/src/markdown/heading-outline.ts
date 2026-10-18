import type { NodePath } from './block-outline.ts';
import type { EditorDocument } from './editor-node.ts';
import { nodeText } from './node-text.ts';

/** A heading as the outline lists it: its words, its depth, and where it is. */
export interface OutlineHeading {
  readonly text: string;
  readonly level: number;
  /** The path from the document to the heading, as `nodeAt` and the editor read it. */
  readonly at: NodePath;
}

/**
 * The note's headings in order, for the aside's Outline (UI v2 slice 8a).
 * Only the headings: `blockOutline` lists every block a link can name, which
 * is a picker's list, not a table of contents. A heading with no words is
 * nothing to jump to and is passed over.
 */
export function outlineOf(doc: EditorDocument): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  doc.content.forEach((block, index) => {
    if (block.type !== 'heading') return;
    const text = nodeText(block).replace(/\s+/g, ' ').trim();
    if (text === '') return;
    const level = block.attrs?.['level'];
    headings.push({ text, level: typeof level === 'number' ? level : 1, at: [index] });
  });
  return headings;
}
