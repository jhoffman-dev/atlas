import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  relativeImageSource,
  resolveImageSource,
  type EditorDocument,
  type EditorNode,
} from '@atlas/domain';
import { parseMarkdownBody, renderBlock, serializeMarkdownBody } from './markdown-blocks.ts';

/** The ways a note written elsewhere — Obsidian, an editor, by hand — puts in an image. */
const IMAGE_LINES: Array<[label: string, markdown: string]> = [
  ['Obsidian markdown-link paste', '![](Pasted%20image%2020230101093012.png)'],
  ['relative, climbing', '![A chart](../attachments/Q3%20chart.png)'],
  ['angle-bracket destination with a space', '![alt](<attachments/my image.png>)'],
  ['with a title', '![alt](a.png "The title")'],
  ['Obsidian size in the alt text', '![diagram|300](diagram.png)'],
  ['Obsidian wiki embed', '![[Pasted image 20230101093012.png]]'],
  ['external', '![logo](https://example.com/logo.svg)'],
  ['HTML image', '<img src="a.png" width="200">'],
  ['reference-style', '![alt][pic]\n\n[pic]: attachments/pic.png'],
  ['several on a line with text', 'Before ![a](a.png) between ![b](b%20c.png) after'],
];

const body = (line: string) => `# Photos\n\n${line}\n\nSome text after.\n`;

describe('a note with images, saved after editing something else', () => {
  it.each(IMAGE_LINES)('keeps a %s byte-identical', (_label, line) => {
    const original = body(line);
    const parsed = parseMarkdownBody(original);
    const content = [...parsed.doc.content];
    const last = content.length - 1;
    content[last] = { ...content[last]!, content: [{ type: 'text', text: 'Edited.' }] };

    const saved = serializeMarkdownBody({
      originalBody: original,
      parsed,
      doc: { type: 'doc', content },
    });

    expect(saved).toBe(`# Photos\n\n${line}\n\nEdited.\n`);
  });

  it.each(IMAGE_LINES)('keeps a %s byte-identical when nothing is edited', (_label, line) => {
    const original = body(line);
    const parsed = parseMarkdownBody(original);
    expect(serializeMarkdownBody({ originalBody: original, parsed, doc: parsed.doc })).toBe(
      original,
    );
  });
});

/** Adds a paragraph holding one image to the end of `original`, as the editor does on a paste. */
function withImageAdded(original: string, image: { src: string; alt: string }): string {
  const parsed = parseMarkdownBody(original);
  const added: EditorNode = {
    type: 'paragraph',
    content: [{ type: 'image', attrs: { src: image.src, alt: image.alt, title: null } }],
  };
  const doc: EditorDocument = { type: 'doc', content: [...parsed.doc.content, added] };
  return serializeMarkdownBody({ originalBody: original, parsed, doc });
}

describe('an embedded image, as it is written into the note', () => {
  const notePath = createVaultPath('Work/Plans/q3.md');
  const imagePath = createVaultPath('attachments/Pasted image 20260925143012.png');
  const src = relativeImageSource({ notePath, imagePath });

  it('is a standard markdown image with a relative, percent-encoded path', () => {
    const saved = withImageAdded('Intro.\n', { src, alt: '' });
    expect(saved).toBe('Intro.\n\n![](../../attachments/Pasted%20image%2020260925143012.png)\n');
  });

  it('keeps its alt text, escaped where markdown needs it', () => {
    const saved = withImageAdded('', { src: 'a.png', alt: 'a [bracketed] word' });
    expect(saved).toBe('![a \\[bracketed\\] word](a.png)\n');
    const reparsed = parseMarkdownBody(saved).doc.content[0]?.content?.[0];
    expect(reparsed?.attrs?.['alt']).toBe('a [bracketed] word');
  });

  it('reads back to the same destination, which resolves to the saved file', () => {
    const saved = withImageAdded('Intro.\n', { src, alt: 'shot' });
    const node = parseMarkdownBody(saved).doc.content[1]?.content?.[0];
    expect(node).toEqual({ type: 'image', attrs: { src, alt: 'shot', title: null } });
    expect(resolveImageSource({ src: String(node?.attrs?.['src']), notePath })).toEqual({
      kind: 'vault',
      path: imagePath,
    });
  });

  it('keeps an angle-bracket destination readable when its alt text is edited', () => {
    const { doc } = parseMarkdownBody('![old](<attachments/my image.png>)\n');
    const paragraph = doc.content[0]!;
    const image = paragraph.content![0]!;
    const edited = { ...paragraph, content: [{ ...image, attrs: { ...image.attrs, alt: 'new' } }] };
    expect(renderBlock(edited)).toBe('![new](<attachments/my image.png>)');
  });
});

/** `line` with ` more` typed at the end of its paragraph, as saved. */
function typedAfter(line: string): string {
  const original = `${line}\n`;
  const parsed = parseMarkdownBody(original);
  const paragraph = parsed.doc.content[0]!;
  const edited: EditorNode = {
    ...paragraph,
    content: [...(paragraph.content ?? []), { type: 'text', text: ' more' }],
  };
  return serializeMarkdownBody({
    originalBody: original,
    parsed,
    doc: { type: 'doc', content: [edited] },
  });
}

describe('an Obsidian image embed in a paragraph that is edited', () => {
  it.each([
    ['a lone embed', '![[Pasted image 20230101093012.png]]'],
    ['an embed with a size', '![[diagram.png|300]]'],
    ['an embed after text', 'See ![[chart.png]]'],
  ])('writes %s back as an embed, its `!` unescaped', (_label, line) => {
    expect(typedAfter(line)).toBe(`${line} more\n`);
  });
});

describe('an image in a paragraph that is edited around it', () => {
  it.each([
    ['a title in single quotes', "See ![alt](a.png 't')"],
    ['a title in parentheses', 'See ![alt](a.png (t))'],
    ['parentheses in the path', 'See ![alt](a(1).png)'],
    ['an ampersand', 'See ![R&D](r&d.png)'],
    ['emphasis in the alt text', 'See ![a *b* c](x.png)'],
    ['two images that read the same, written differently', '![a](x.png \'t\') ![a](x.png "t")'],
  ])('keeps an image with %s byte-identical', (_label, line) => {
    expect(typedAfter(line)).toBe(`${line} more\n`);
  });

  it('writes an image whose alt text was edited from what it now holds', () => {
    const original = "See ![old](a(1).png 't')\n";
    const parsed = parseMarkdownBody(original);
    const paragraph = parsed.doc.content[0]!;
    const content = (paragraph.content ?? []).map((node) =>
      node.type === 'image' ? { ...node, attrs: { ...node.attrs, alt: 'new' } } : node,
    );
    const saved = serializeMarkdownBody({
      originalBody: original,
      parsed,
      doc: { type: 'doc', content: [{ ...paragraph, content }] },
    });
    expect(saved).toBe('See ![new](a\\(1\\).png "t")\n');
  });
});
