/** Attack on PR #428: a link card's lines read as the note does — words never run together. */
import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from './editor-node.ts';
import { previewLines } from './note-preview.ts';

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

describe('previewLines (attack-428)', () => {
  it('keeps the words either side of a hard line break apart', () => {
    const note = doc(
      paragraph(text('Call the bank'), { type: 'hardBreak' }, text('then the post')),
    );
    expect(previewLines(note, 'Errand')).not.toContain('bankthen');
  });

  it('reads each paragraph of a quote as its own words, not run into the next', () => {
    const quote: EditorNode = {
      type: 'blockquote',
      content: [paragraph(text('First thought.')), paragraph(text('Second thought.'))],
    };
    expect(previewLines(doc(quote), 'Errand')).not.toContain('thought.Second');
  });
});
