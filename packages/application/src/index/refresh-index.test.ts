import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { refreshIndex, toIndexedNote } from './refresh-index.ts';
import type { IndexedNote, IndexEntry, IndexPort } from './ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';

/** A markdown port with real-enough behaviour for indexing, without remark. */
const markdown: MarkdownPort = {
  parseBody: () => ({ blocks: [], doc: { type: 'doc', content: [] } }),
  serializeBody: () => '',
  rawParts: () => [],
  frontmatterProblem: () => null,
  frontmatterKeyTexts: () => ({}),
  frontmatterProperties: (frontmatter) =>
    frontmatter === null
      ? {}
      : Object.fromEntries(
          frontmatter
            .split('\n')
            .map((line) => /^(\w+):\s*(.*)$/.exec(line))
            .filter((match): match is RegExpExecArray => match !== null)
            .map((match) => [match[1] as string, match[2] as string]),
        ),
  plainText: (body) => body.trim(),
  textRanges: (body: string) => [{ start: 0, end: body.length }],
  updateFrontmatter: (_frontmatter, changes) =>
    `---\n${Object.entries(changes)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n')}\n---\n`,
};

function fakeVault(files: Record<string, { text: string; modified: number }>) {
  const fs: VaultFsPort = {
    listDirectory: async () => [],
    listNotes: async () =>
      Object.entries(files).map(([path, file]) => ({
        name: path.split('/').at(-1) ?? path,
        path: createVaultPath(path),
        modified: file.modified,
        size: file.text.length,
      })),
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const file = files[path];
        return file === undefined
          ? []
          : [{ path, text: file.text, modified: file.modified, size: file.text.length }];
      }),
    readBinaryFile: async () => new ArrayBuffer(0),
    createNote: async () => {},
    createFolder: async () => {},
    moveEntry: async () => {},
    trashEntry: async () => {},
    writeBinaryFile: async () => 0,
    readTextFile: async () => ({ text: '', modified: 0 }),
    writeTextFile: async () => 0,
  };
  return fs;
}

function fakeIndex(entries: IndexEntry[] = []) {
  const written: IndexedNote[] = [];
  const removed: string[] = [];
  const index: IndexPort = {
    open: async () => {},
    clear: async () => {},
    manifest: async () => entries,
    put: async (notes) => {
      written.push(...notes);
    },
    remove: async (paths) => {
      removed.push(...paths);
    },
    search: async () => [],
    backlinks: async () => [],
    notesOfType: async () => [],
    rebuildViews: async () => {},
    query: async () => ({ columns: [], rows: [], truncated: false }),
    stats: async () => ({ notes: 0, properties: 0, links: 0 }),
  };
  return { index, written, removed };
}

describe('refreshIndex', () => {
  it('indexes every note when the index is empty', async () => {
    const fs = fakeVault({ 'a.md': { text: 'alpha', modified: 1 } });
    const { index, written } = fakeIndex();

    const result = await refreshIndex({ fs, index, markdown });

    expect(result).toMatchObject({ indexed: 1, removed: 0, unchanged: 0 });
    expect(written.map((note) => note.path)).toEqual(['a.md']);
  });

  it('skips notes that have not changed', async () => {
    const fs = fakeVault({ 'a.md': { text: 'alpha', modified: 1 } });
    const { index, written } = fakeIndex([{ path: 'a.md', modified: 1, size: 5 }]);

    const result = await refreshIndex({ fs, index, markdown });

    expect(result).toMatchObject({ indexed: 0, unchanged: 1 });
    expect(written).toEqual([]);
  });

  it('re-indexes a note whose modification time changed', async () => {
    const fs = fakeVault({ 'a.md': { text: 'alpha', modified: 2 } });
    const { index, written } = fakeIndex([{ path: 'a.md', modified: 1, size: 5 }]);

    await refreshIndex({ fs, index, markdown });
    expect(written).toHaveLength(1);
  });

  it('re-indexes a note whose size changed even at the same timestamp', async () => {
    const fs = fakeVault({ 'a.md': { text: 'alpha and more', modified: 1 } });
    const { index, written } = fakeIndex([{ path: 'a.md', modified: 1, size: 5 }]);

    await refreshIndex({ fs, index, markdown });
    expect(written).toHaveLength(1);
  });

  it('removes notes that are no longer in the vault', async () => {
    const fs = fakeVault({});
    const { index, removed } = fakeIndex([{ path: 'gone.md', modified: 1, size: 1 }]);

    const result = await refreshIndex({ fs, index, markdown });

    expect(removed).toEqual(['gone.md']);
    expect(result.removed).toBe(1);
  });

  it('does not call remove when nothing was deleted', async () => {
    const fs = fakeVault({ 'a.md': { text: 'alpha', modified: 1 } });
    const { index } = fakeIndex([{ path: 'a.md', modified: 1, size: 5 }]);
    const remove = vi.spyOn(index, 'remove');

    await refreshIndex({ fs, index, markdown });
    expect(remove).not.toHaveBeenCalled();
  });

  it('reports progress as it goes', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 3 }, (_, i) => [`n${i}.md`, { text: 'x', modified: 1 }]),
    );
    const { index } = fakeIndex();
    const onProgress = vi.fn();

    await refreshIndex({ fs: fakeVault(files), index, markdown, onProgress });

    expect(onProgress).toHaveBeenCalledWith(3, 3);
  });

  it('indexes an empty vault without failing', async () => {
    const { index } = fakeIndex();
    await expect(refreshIndex({ fs: fakeVault({}), index, markdown })).resolves.toMatchObject({
      indexed: 0,
      removed: 0,
    });
  });

  /**
   * The host used to prune dotted folders before the list ever crossed IPC, so
   * nothing here had to rule them out. Now that it returns what is on disk, this
   * is what keeps `.git` out of search results.
   */
  it('leaves out a note the host found in a hidden directory', async () => {
    const fs = fakeVault({
      'keep.md': { text: 'alpha', modified: 1 },
      '.git/COMMIT_EDITMSG.md': { text: 'wip', modified: 1 },
      'node_modules/pkg/readme.md': { text: 'docs', modified: 1 },
      '.secret/private.md': { text: 'shh', modified: 1 },
    });
    const { index, written } = fakeIndex();

    const result = await refreshIndex({ fs, index, markdown });

    expect(written.map((note) => note.path)).toEqual(['keep.md']);
    expect(result.indexed).toBe(1);
  });

  it('indexes .atlas notes, so searching finds a type or a template', async () => {
    const fs = fakeVault({
      '.atlas/types/task.md': { text: 'task type', modified: 1 },
      '.atlas/views/Board.md': { text: 'the board', modified: 1 },
    });
    const { index, written } = fakeIndex();

    await refreshIndex({ fs, index, markdown });

    // The board has a sidebar section of its own; the type definition does not.
    expect(written.map((note) => note.path)).toEqual(['.atlas/types/task.md']);
  });

  it('does not treat a hidden note as deleted and remove it from the index', async () => {
    // A note the frontend never listed was never indexed, so there is nothing to
    // remove — and a removal here would fight the next refresh forever.
    const fs = fakeVault({ '.git/COMMIT_EDITMSG.md': { text: 'wip', modified: 1 } });
    const { index, removed } = fakeIndex();

    await refreshIndex({ fs, index, markdown });

    expect(removed).toEqual([]);
  });

  it('resolves links against user space only', async () => {
    const fs = fakeVault({
      'a.md': { text: 'see [[private]]', modified: 1 },
      '.secret/private.md': { text: 'shh', modified: 1 },
    });
    const { index, written } = fakeIndex();

    await refreshIndex({ fs, index, markdown });

    expect(written[0]?.links).toEqual([{ target: 'private', path: null, kind: 'wikilink' }]);
  });
});

describe('refreshIndex and relations to notes that come and go (P24 review)', () => {
  /** An index that answers the stale-relations question with `holders`, and records it. */
  function indexHolding(entries: IndexEntry[], holders: string[]) {
    const fake = fakeIndex(entries);
    const asked: unknown[][] = [];
    fake.index.query = async (sql, parameters) => {
      asked.push([sql, ...parameters]);
      return sql.includes('FROM relations')
        ? { columns: ['path'], rows: holders.map((path) => [path]), truncated: false }
        : { columns: [], rows: [], truncated: false };
    };
    return { ...fake, asked };
  }

  it('re-reads a note whose relation points at a note that has just been made', async () => {
    const source = '---\nproject: [[Later]]\n---\nbody';
    const fs = fakeVault({
      'a.md': { text: source, modified: 1 },
      'p/Later.md': { text: 'later', modified: 2 },
    });
    const { index, written, asked } = indexHolding(
      [{ path: 'a.md', modified: 1, size: source.length }],
      ['a.md'],
    );

    await refreshIndex({ fs, index, markdown });

    expect(asked.flat()).toContain('later');
    const again = written.find((note) => note.path === 'a.md');
    expect(again?.relations).toEqual([
      { key: 'project', index: 0, target: 'Later', name: 'later', path: 'p/Later.md' },
    ]);
  });

  it('re-reads a note whose relation pointed at a note that has gone', async () => {
    const source = '---\nproject: [[Gone]]\n---\nbody';
    const fs = fakeVault({ 'b.md': { text: source, modified: 1 } });
    const { index, written } = indexHolding(
      [
        { path: 'b.md', modified: 1, size: source.length },
        { path: 'p/Gone.md', modified: 1, size: 4 },
      ],
      ['b.md', 'p/Gone.md'],
    );

    await refreshIndex({ fs, index, markdown });

    // The note that went is not read again; the one that pointed at it is.
    expect(written.map((note) => note.path)).toEqual(['b.md']);
    expect(written[0]?.relations[0]?.path).toBeNull();
  });

  it('asks nothing more when no note came or went', async () => {
    const fs = fakeVault({ 'a.md': { text: 'alpha', modified: 1 } });
    const { index, asked } = indexHolding([{ path: 'a.md', modified: 1, size: 5 }], ['a.md']);
    await refreshIndex({ fs, index, markdown });
    expect(asked).toEqual([]);
  });
});

describe('toIndexedNote', () => {
  const notePaths = ['a.md', 'Notes/Target.md'].map(createVaultPath);

  const build = (text: string) =>
    toIndexedNote({
      file: { path: 'a.md', text, modified: 7, size: text.length },
      notePaths,
      markdown,
    });

  it('takes the title from the filename when the note gives no other', () => {
    expect(build('body').title).toBe('a');
  });

  it('takes the title the page is headed by: the title property, else the filename', () => {
    expect(build('---\ntitle: Today\n---\n# Something else\n').title).toBe('Today');
    // A heading in the body is not the page's name: the page head never shows
    // it, so a list that did would disagree with the page (U-09).
    expect(build('\n# Runs in WebKit\n\nbody').title).toBe('a');
    expect(build('intro\n\n# Later heading\n').title).toBe('a');
  });

  it('indexes the body without its frontmatter', () => {
    expect(build('---\ntitle: Today\n---\nthe body').body).toBe('the body');
  });

  it('turns frontmatter into properties', () => {
    expect(build('---\nstatus: draft\n---\nbody').properties).toEqual([
      { key: 'status', index: 0, text: 'draft', number: null, date: null, json: null },
    ]);
  });

  it('records a link and where it resolves to', () => {
    expect(build('see [[Target]] here').links).toEqual([
      { target: 'Target', path: 'Notes/Target.md', kind: 'wikilink' },
    ]);
  });

  it('records each property written as a link, resolved the way a link in the body is', () => {
    expect(build('---\nproject: "[[target]]"\nowner: "[[Nobody]]"\n---\nbody').relations).toEqual([
      { key: 'project', index: 0, target: 'target', name: 'target', path: 'Notes/Target.md' },
      { key: 'owner', index: 0, target: 'Nobody', name: 'nobody', path: null },
    ]);
  });

  it('records each block with an id, as the editor reads the body (P26-01)', () => {
    const parseBody = vi.fn(() => ({
      blocks: [],
      doc: {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            attrs: { anchor: 'f3k9x2' },
            content: [{ type: 'text', text: 'Plan' }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'No id' }] },
        ],
      },
    }));
    const note = toIndexedNote({
      file: { path: 'a.md', text: 'Plan ^f3k9x2\n\nNo id\n', modified: 1, size: 20 },
      notePaths,
      markdown: { ...markdown, parseBody },
    });
    expect(note.blocks).toEqual([{ id: 'f3k9x2', text: 'Plan' }]);
    expect(parseBody).toHaveBeenCalledWith('Plan ^f3k9x2\n\nNo id\n');
  });

  it('does not parse a body with no caret in it for block ids', () => {
    const parseBody = vi.fn(markdown.parseBody);
    const note = toIndexedNote({
      file: { path: 'a.md', text: 'plain', modified: 1, size: 5 },
      notePaths,
      markdown: { ...markdown, parseBody },
    });
    expect(note.blocks).toEqual([]);
    expect(parseBody).not.toHaveBeenCalled();
  });

  it('records a link that points nowhere, so it can be found later', () => {
    expect(build('see [[Missing]] here').links).toEqual([
      { target: 'Missing', path: null, kind: 'wikilink' },
    ]);
  });

  it('records every use of a tag, the tags property first, keyed without case', () => {
    expect(
      build('---\ntags: Project, para/area\n---\nsee #Idea and #idea, and #tag me#').tags,
    ).toEqual([
      { key: 'project', name: 'Project' },
      { key: 'para/area', name: 'para/area' },
      { key: 'idea', name: 'Idea' },
      { key: 'idea', name: 'idea' },
      { key: 'tag me', name: 'tag me' },
    ]);
  });

  it('records no tags for a note without any, nor a heading', () => {
    expect(build('# Heading\n\nplain text').tags).toEqual([]);
  });

  it('keeps the file facts for change detection', () => {
    expect(build('body')).toMatchObject({ modified: 7, size: 4 });
  });
});
