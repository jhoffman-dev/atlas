import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';
import { documentOf, generatedDocument } from './writer-fuzz.test-support.ts';

/**
 * Seeds past the 3000 that `writer-reads-back.property.test.ts` runs, found by
 * running its "saved, reopened and edited again" case over seeds 3001–13000
 * (A21-03 adversarial pass). Each one's note is written, reopened, has `Q `
 * typed into every paragraph and heading, and is saved again; the second save
 * does not read back as the editor had it. Every one holds text GFM reads as
 * an address once reopened (`http\://`, `www\.`, `a\@b.co`), which the second
 * save writes as `<…>` or `[…](…)`; eight of the nine are in a table cell.
 */
const SEEDS = [5397, 6538, 6757, 8026, 9813, 10620, 11707, 12043, 12562];

function editedEverywhere(doc: EditorDocument): EditorDocument {
  const edit = (node: EditorNode): EditorNode => {
    if (node.type === 'paragraph' || node.type === 'heading')
      return { ...node, content: [{ type: 'text', text: 'Q ' }, ...(node.content ?? [])] };
    return node.content === undefined ? node : { ...node, content: node.content.map(edit) };
  };
  return { type: 'doc', content: doc.content.map(edit) };
}

describe('a note saved, reopened and edited again reads back as the editor had it', () => {
  it.each(SEEDS)('for seed %i', (seed) => {
    const original = serializeMarkdownBody({
      originalBody: '',
      parsed: parseMarkdownBody(''),
      doc: generatedDocument(seed),
    });
    const parsed = parseMarkdownBody(original);
    const doc = editedEverywhere(parsed.doc);
    const saved = serializeMarkdownBody({ originalBody: original, parsed, doc });
    expect(documentOf(parseMarkdownBody(saved).doc.content), saved).toBe(documentOf(doc.content));
  });
});
