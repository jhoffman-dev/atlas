import {
  blockEmbedNode,
  readWikiLink,
  splitWikiLinksAndEmbeds,
  trailingBlockAnchor,
  type EditorNode,
  type ParsedBody,
} from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import type { MarkdownPort } from '../notes/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded } from '../testing/api-fixture.ts';
import { fakeMarkdown } from '../testing/fake-ports.ts';

/**
 * Markdown read a paragraph at a time, each a line of text and links with
 * any `^id` at its end, or a block shown in place when the line is only
 * `![[Note#^id]]`; written back as
 * the words, a quote's with `> `. Enough to see what a route reads and
 * answers; how the real reader and writer see a note is the markdown
 * adapter's, and is tested there (`confluence-export.test.ts`).
 */
function lineMarkdown(): MarkdownPort {
  const paragraphOf = (line: string): EditorNode => {
    const embed = readWikiLink(line);
    if (embed?.embed === true) return blockEmbedNode(embed);
    const anchor = trailingBlockAnchor(line);
    const words = anchor === null ? line : line.slice(0, anchor.start);
    const content = splitWikiLinksAndEmbeds(words).map((piece) =>
      piece.kind === 'text'
        ? { type: 'text', text: piece.value }
        : { type: 'wikiLink', attrs: { ...piece } },
    );
    return { type: 'paragraph', ...(anchor && { attrs: { anchor: anchor.id } }), content };
  };
  const written = (node: EditorNode): string =>
    node.type === 'blockquote'
      ? (node.content ?? []).map((child) => `> ${written(child)}`).join('\n')
      : (node.content ?? []).map((child) => child.text ?? '').join('');
  return {
    ...fakeMarkdown(),
    parseBody: (body): ParsedBody => ({
      blocks: [],
      doc: { type: 'doc', content: body.split('\n\n').filter(Boolean).map(paragraphOf) },
    }),
    serializeBody: ({ doc }) => `${doc.content.map(written).join('\n\n')}\n`,
  };
}

const FILES = {
  'Meetings/Weekly sync.md': '---\ntype: meeting\n---\nAsk [[Mara Quill]] about [[task]].',
  'People/Mara Quill.md': '---\ntitle: Mara Q.\n---\nBlock. ^m1',
  '.atlas/types/task.md': '---\nname: task\ntitle: Atlas task type\n---\nSettings. ^s1',
  '.obsidian/secret.md': '---\ntitle: Hidden title\n---\nHidden. ^h1',
};

const exportOf = (path: string, query: Record<string, string> = { format: 'confluence' }) =>
  apiFixture({ files: FILES, markdown: lineMarkdown() }).send({
    method: 'GET',
    path: `/v1/notes/${encoded(path)}/export`,
    query,
  });

describe('GET /v1/notes/{path}/export', () => {
  it('answers the note as markdown for a page, its title, and what it left out', async () => {
    const response = await exportOf('Meetings/Weekly sync.md');

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      export: {
        path: 'Meetings/Weekly sync.md',
        format: 'confluence',
        title: 'Weekly sync',
        markdown: 'Ask Mara Q. about task.\n',
        dropped: [
          { kind: 'property', items: ['type'] },
          { kind: 'link', items: ['[[Mara Quill]]', '[[task]]'] },
        ],
      },
    });
  });

  it('reads nothing from .atlas or a hidden folder into the page', async () => {
    const api = apiFixture({
      files: {
        ...FILES,
        'Share.md': '![[People/Mara Quill#^m1]]\n\n![[.atlas/types/task#^s1]]\n\n![[secret#^h1]]',
      },
      markdown: lineMarkdown(),
    });

    const response = await api.send({
      method: 'GET',
      path: `/v1/notes/${encoded('Share.md')}/export`,
      query: { format: 'confluence' },
    });

    const { markdown, dropped } = bodyOf(response)['export'] as Record<string, unknown>;
    expect(markdown).toBe(
      '> From Mara Q.\n> Block.\n\n[Not found: .atlas/types/task]\n\n[Not found: secret]\n',
    );
    expect(dropped).toContainEqual({
      kind: 'missing-embed',
      items: ['![[.atlas/types/task#^s1]]', '![[secret#^h1]]'],
    });
  });

  it('writes nothing', async () => {
    const api = apiFixture({ files: FILES, markdown: lineMarkdown() });
    const before = new Map([...api.files].map(([path, file]) => [path, file.text]));

    const response = await api.send({
      method: 'GET',
      path: `/v1/notes/${encoded('Meetings/Weekly sync.md')}/export`,
      query: { format: 'confluence' },
    });

    expect(response.status).toBe(200);
    expect(api.writes).toEqual([]);
    expect(new Map([...api.files].map(([path, file]) => [path, file.text]))).toEqual(before);
  });

  it.each([{}, { format: 'markdown' }, { format: 'Confluence' }])(
    'refuses a format other than confluence: %j',
    async (query) => {
      const response = await exportOf('Meetings/Weekly sync.md', query);
      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('invalid');
    },
  );

  it('refuses a note in .atlas, and answers not_found for one that is not there', async () => {
    expect(codeOf(await exportOf('.atlas/types/task.md'))).toBe('invalid');
    expect(codeOf(await exportOf('Nowhere.md'))).toBe('not_found');
  });
});
