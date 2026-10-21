import {
  blockEmbedNode,
  readWikiLink,
  splitWikiLinksAndEmbeds,
  trailingBlockAnchor,
  type EditorNode,
  type ParsedBody,
} from '@dfai/domain';
import { describe, expect, it } from 'vitest';
import type { MarkdownPort } from '../notes/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded, type ApiFixture } from '../testing/api-fixture.ts';
import { fakeMarkdown } from '../testing/fake-ports.ts';

/**
 * Markdown read a paragraph at a time, each a line of text and links with
 * any `^id` at its end, or a block shown in place when the line is only
 * `![[Note#^id]]`; written back as
 * the words, a quote's with `> `, a picture as `![alt](src)`. Enough to see what a route reads and
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
  const inline = (node: EditorNode): string =>
    node.type === 'image'
      ? `![${String(node.attrs?.['alt'])}](${String(node.attrs?.['src'])})`
      : (node.text ?? '');
  const written = (node: EditorNode): string =>
    node.type === 'blockquote'
      ? (node.content ?? []).map((child) => `> ${written(child)}`).join('\n')
      : (node.content ?? []).map(inline).join('');
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
  '.atlas/types/task.md': '---\nname: task\ntitle: DFAI task type\n---\nSettings. ^s1',
  '.obsidian/secret.md': '---\ntitle: Hidden title\n---\nHidden. ^h1',
};

const messageOf = (response: { body: unknown }) =>
  (response.body as { error?: { message: string } }).error?.message;

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

  it.each([{}, { format: 'Confluence' }, { format: 'pdf' }, { format: 'google-doc' }])(
    'refuses a format other than confluence, markdown or standalone: %j',
    async (query) => {
      const response = await exportOf('Meetings/Weekly sync.md', query);
      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('invalid');
      expect(messageOf(response)).toBe('format must be "confluence", "markdown" or "standalone"');
    },
  );

  it('refuses a note in .atlas, and answers not_found for one that is not there', async () => {
    expect(codeOf(await exportOf('.atlas/types/task.md'))).toBe('invalid');
    expect(codeOf(await exportOf('Nowhere.md'))).toBe('not_found');
  });
});

const encoder = new TextEncoder();
const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * The fixture with each note's bytes held as well as its text, as the host
 * reads any file as bytes; `bytes` gives a file bytes of its own (a picture,
 * or a note whose bytes text cannot show).
 */
function exportApi(files: Record<string, string>, bytes: Record<string, Uint8Array> = {}) {
  const api = apiFixture({ files, markdown: lineMarkdown() });
  for (const [path, text] of Object.entries(files)) api.binaries.set(path, encoder.encode(text));
  for (const [path, held] of Object.entries(bytes)) api.binaries.set(path, held);
  return api;
}

const exportFrom = (api: ApiFixture, path: string, query: Record<string, string>) =>
  api.send({ method: 'GET', path: `/v1/notes/${encoded(path)}/export`, query });

const answerOf = (response: { body: unknown }) =>
  bodyOf(response as Parameters<typeof bodyOf>[0])['export'] as Record<string, unknown>;

const KICKOFF = {
  ...FILES,
  'Meetings/Kickoff.md':
    '---\ntype: meeting\n---\nAsk [[Mara Quill]] about [[task]].\n\nPlan: ![[Q3 plan (v2).png]] and ![[.obsidian/hidden.png]]',
};
const KICKOFF_PICTURES = {
  'Pictures/Q3 plan (v2).png': PICTURE,
  'attachments/Q3 plan (v2).png': PICTURE,
  '.obsidian/hidden.png': PICTURE,
};

describe('GET /v1/notes/{path}/export?format=markdown', () => {
  it('answers the file as it is, byte for byte, CRLF lines and all', async () => {
    const text = '---\ntitle: Kickoff with Tobias\n---\nLine one\r\n\r\nLine  two \t\n\n\n';
    const api = exportApi({ 'Kickoff.md': text });

    const response = await exportFrom(api, 'Kickoff.md', { format: 'markdown' });

    expect(response.status).toBe(200);
    expect(answerOf(response)).toEqual({
      path: 'Kickoff.md',
      format: 'markdown',
      title: 'Kickoff with Tobias',
      markdown: text,
      attachments: [],
    });
  });

  it('keeps a byte-order mark the file starts with', async () => {
    const api = exportApi(
      { 'Marked.md': 'Body\n' },
      { 'Marked.md': new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('Body\n')]) },
    );

    const { markdown } = answerOf(await exportFrom(api, 'Marked.md', { format: 'markdown' }));

    expect(markdown).toBe('\uFEFFBody\n');
  });

  it('refuses a file that is not UTF-8 rather than answer it changed', async () => {
    const api = exportApi({ 'Latin.md': 'caf' }, { 'Latin.md': new Uint8Array([0x63, 0xe9]) });

    const response = await exportFrom(api, 'Latin.md', { format: 'markdown' });

    expect(codeOf(response)).toBe('invalid');
  });

  it('lists the pictures in user space the note shows, by vault path and copy name', async () => {
    const api = exportApi(KICKOFF, KICKOFF_PICTURES);

    const answer = answerOf(await exportFrom(api, 'Meetings/Kickoff.md', { format: 'markdown' }));

    expect(answer['markdown']).toBe(KICKOFF['Meetings/Kickoff.md']);
    expect(answer['attachments']).toEqual([
      { path: 'attachments/Q3 plan (v2).png', as: 'Q3 plan (v2).png' },
    ]);
  });
});

describe('GET /v1/notes/{path}/export?format=standalone', () => {
  it('makes links words and links each picture at attachments/, frontmatter kept', async () => {
    const api = exportApi(KICKOFF, KICKOFF_PICTURES);

    const response = await exportFrom(api, 'Meetings/Kickoff.md', { format: 'standalone' });

    expect(response.status).toBe(200);
    expect(answerOf(response)).toEqual({
      path: 'Meetings/Kickoff.md',
      format: 'standalone',
      title: 'Kickoff',
      markdown:
        '---\ntype: meeting\n---\nAsk Mara Q. about task.\n\n' +
        'Plan: ![Q3 plan (v2).png](attachments/Q3%20plan%20%28v2%29.png) and .obsidian/hidden.png\n',
      attachments: [{ path: 'attachments/Q3 plan (v2).png', as: 'attachments/Q3 plan (v2).png' }],
      dropped: [
        { kind: 'link', items: ['[[Mara Quill]]', '[[task]]'] },
        { kind: 'embed', items: ['![[.obsidian/hidden.png]]'] },
      ],
    });
  });

  it('drops the frontmatter when asked', async () => {
    const api = exportApi(KICKOFF, KICKOFF_PICTURES);

    const { markdown } = answerOf(
      await exportFrom(api, 'Meetings/Kickoff.md', { format: 'standalone', frontmatter: 'drop' }),
    );

    expect(markdown).toMatch(/^Ask Mara Q\. about task\./);
  });

  it('inlines a note it embeds only from user space', async () => {
    // A space after each embed keeps the fake reading it as an embed in a
    // paragraph, as the editor holds a note embedded whole, not a shown block.
    const api = exportApi({
      ...FILES,
      'Share.md': '![[People/Mara Quill]] \n\n![[.atlas/types/task]] ',
    });

    const { markdown } = answerOf(
      await exportFrom(api, 'Share.md', { format: 'standalone', frontmatter: 'drop' }),
    );

    expect(markdown).toContain('Block.');
    expect(markdown).not.toContain('Settings.');
  });

  it.each([{ frontmatter: 'Keep' }, { frontmatter: '' }, { frontmatter: 'yes' }])(
    'refuses frontmatter other than keep or drop: %j',
    async (query) => {
      const api = exportApi(KICKOFF);
      const response = await exportFrom(api, 'Meetings/Kickoff.md', {
        format: 'standalone',
        ...query,
      });
      expect(codeOf(response)).toBe('invalid');
      expect(messageOf(response)).toBe('frontmatter must be "keep" or "drop"');
    },
  );

  it.each(['markdown', 'confluence'])('refuses frontmatter with format=%s', async (format) => {
    const response = await exportFrom(exportApi(KICKOFF), 'Meetings/Kickoff.md', {
      format,
      frontmatter: 'drop',
    });
    expect(codeOf(response)).toBe('invalid');
  });

  it.each(['markdown', 'standalone'])(
    'format=%s refuses a note in .atlas, answers not_found for none, and writes nothing',
    async (format) => {
      const api = exportApi(KICKOFF, KICKOFF_PICTURES);
      const before = new Map([...api.files].map(([path, file]) => [path, file.text]));

      expect(codeOf(await exportFrom(api, '.atlas/types/task.md', { format }))).toBe('invalid');
      expect(codeOf(await exportFrom(api, 'Nowhere.md', { format }))).toBe('not_found');
      expect((await exportFrom(api, 'Meetings/Kickoff.md', { format })).status).toBe(200);

      expect(api.writes).toEqual([]);
      expect(new Map([...api.files].map(([path, file]) => [path, file.text]))).toEqual(before);
    },
  );
});
