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

/** A heading is one of six levels; attrs saying otherwise are read as the nearest. */
const LEVELS = { top: 1, deepest: 6 };

/**
 * The note's top-level headings in order, for the aside's Outline (UI v2
 * slice 8a). Only the headings, and only the document's own: one inside a
 * quote or a callout is that block's, as `blockOutline` reads it. The block
 * outline lists every block a link can name, which is a picker's list, not a
 * table of contents. A heading with no words is nothing to jump to and is
 * passed over.
 */
export function outlineOf(doc: EditorDocument): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  doc.content.forEach((block, index) => {
    if (block.type !== 'heading') return;
    const text = nodeText(block).replace(/\s+/g, ' ').trim();
    if (text === '') return;
    headings.push({ text, level: levelOf(block.attrs?.['level']), at: [index] });
  });
  return headings;
}

function levelOf(attr: unknown): number {
  if (typeof attr !== 'number' || !Number.isFinite(attr)) return LEVELS.top;
  return Math.min(LEVELS.deepest, Math.max(LEVELS.top, Math.round(attr)));
}
