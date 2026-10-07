import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * A mention made with `@` is a plain wiki link in the document, drawn as a
 * person's chip only on screen (P21-02). Whatever happens to the paragraph
 * around it, the file keeps `[[Name]]` as Obsidian writes it — never escaped
 * (`\[\[`), never turned into anything Atlas alone would read.
 */
const body = (paragraph: string) => `# Standup\n\n${paragraph}\n\nLast paragraph.\n`;

/** The document with its second block — the paragraph under test — changed by `edit`. */
function editParagraph(
  markdown: string,
  edit: (content: readonly EditorNode[]) => EditorNode[],
): string {
  const parsed = parseMarkdownBody(markdown);
  const content = [...parsed.doc.content];
  const paragraph = content[1]!;
  content[1] = { ...paragraph, content: edit(paragraph.content ?? []) };
  const doc: EditorDocument = { type: 'doc', content };
  return serializeMarkdownBody({ originalBody: markdown, parsed, doc });
}

const mention = (target: string): EditorNode => ({
  type: 'wikiLink',
  attrs: { target, heading: null, alias: null },
});

describe('a person mentioned in a note', () => {
  it.each([
    ['a name', 'Met [[Julie Brandt-Hoffer]] about the plan.'],
    ['a name that needs its path', 'Ask [[People/Sam]] and [[Clients/Sam]].'],
    ['a mention opening the paragraph', '[[Julie]] said yes.'],
  ])('keeps %s byte-for-byte when the paragraph is edited', (_label, paragraph) => {
    const saved = editParagraph(body(paragraph), (content) => [
      ...content,
      { type: 'text', text: ' Later.' },
    ]);
    expect(saved).toBe(body(`${paragraph} Later.`));
  });

  it('writes a mention just picked from @ as a plain wiki link, in the middle of a sentence', () => {
    const saved = editParagraph(body('Call  tomorrow.'), () => [
      { type: 'text', text: 'Call ' },
      mention('Julie Brandt-Hoffer'),
      { type: 'text', text: ' tomorrow.' },
    ]);
    expect(saved).toBe(body('Call [[Julie Brandt-Hoffer]] tomorrow.'));
  });

  it('writes a note saved while a person is being made as its paragraph reads without them', () => {
    // What the editor hands over: the placeholder left out, the text around it joined.
    const saved = editParagraph(body('With @Ann Lee'), () => [
      { type: 'text', text: 'With  will call' },
    ]);
    expect(saved).toBe(body('With  will call'));
  });

  it('refuses a placeholder that reached it, rather than writing it into the file', () => {
    // The editor's alone (A21-02): one arriving here is a bug, and is loud.
    expect(() =>
      editParagraph(body('With @Ann Lee'), () => [
        { type: 'text', text: 'With ' },
        { type: 'mentionPending', attrs: { id: 'pending-1', name: 'Ann Lee' } },
      ]),
    ).toThrow(/mentionPending/);
  });
});
