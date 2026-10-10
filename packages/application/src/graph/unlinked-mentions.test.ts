import { describe, expect, it, vi } from 'vitest';
import { createVaultPath, resolveWikiLinkTarget, type ParsedBody } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { OpenNoteState } from '../api/ports.ts';
import {
  findUnlinkedMentions,
  linkUnlinkedMention,
  MentionNotLinkedError,
} from './unlinked-mentions.ts';

/**
 * Blocks split on blank lines; a block opening with a fence is code. Enough
 * of a parser to show which blocks the use-case looks in — the real one's
 * ranges are the markdown adapter's, tested with it.
 */
function parseBody(body: string): ParsedBody {
  const blocks = [...body.matchAll(/[^\n]+(?:\n[^\n]+)*/g)].map((match, index) => ({
    id: `b${index}`,
    index,
    source: match[0],
    start: match.index,
    end: match.index + match[0].length,
    normalized: match[0],
  }));
  return {
    blocks,
    doc: {
      type: 'doc',
      content: blocks.map((block) => ({
        type: block.source.startsWith('```') ? 'codeBlock' : 'paragraph',
      })),
    },
  };
}

const markdown = { ...fakeMarkdown(), parseBody };
const atlas = { path: createVaultPath('projects/Atlas.md'), title: 'Atlas' };

const files: Record<string, string> = {
  'mentions.md': '---\ntype: doc\n---\nWe build atlas here.\n',
  'coded.md': '```\nAtlas\n```\n',
  'linked.md': 'See [[Atlas]] and Atlas.\n',
  'projects/Atlas.md': 'Atlas is me.\n',
};

const search = vi.fn(async () =>
  Object.keys(files).map((path) => ({ path, title: path.replace('.md', ''), snippet: '' })),
);

const fs = fakeVaultFs({
  readNotes: async (paths) =>
    paths.map((path) => ({ path, text: files[path] ?? '', modified: 1, size: 1 })),
});

describe('findUnlinkedMentions', () => {
  it('lists notes naming this one in their prose, with the words around it', async () => {
    const found = await findUnlinkedMentions({
      index: fakeIndexPort({ search }),
      fs,
      markdown,
      note: atlas,
      linkedFrom: [createVaultPath('linked.md')],
    });
    expect(found).toEqual([
      { path: 'mentions.md', title: 'mentions', excerpt: 'We build atlas here.' },
    ]);
  });

  it('asks the index for each name the note goes by', async () => {
    search.mockClear();
    await findUnlinkedMentions({
      index: fakeIndexPort({ search }),
      fs,
      markdown,
      note: { path: createVaultPath('atlas-plan.md'), title: 'The Atlas plan' },
      linkedFrom: [],
    });
    expect(search.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      '"atlas-plan"*',
      '"The" "Atlas" "plan"*',
    ]);
  });

  it('reads nothing when the index finds nothing', async () => {
    const readNotes = vi.fn(async () => []);
    const found = await findUnlinkedMentions({
      index: fakeIndexPort(),
      fs: fakeVaultFs({ readNotes }),
      markdown,
      note: atlas,
      linkedFrom: [],
    });
    expect(found).toEqual([]);
    expect(readNotes).not.toHaveBeenCalled();
  });
});

function writableVault(text: string) {
  const writeTextFile = vi.fn(async () => 2);
  return {
    writeTextFile,
    fs: fakeVaultFs({ readTextFile: async () => ({ text, modified: 7 }), writeTextFile }),
  };
}

/** An index that knows these notes, which decides how a link must name its target. */
const indexOf = (...paths: string[]) =>
  fakeIndexPort({ manifest: async () => paths.map((path) => ({ path, modified: 1, size: 1 })) });
const indexed = indexOf(atlas.path, 'mentions.md');

const panes = (state: OpenNoteState) => ({ state: () => state, reload: vi.fn() });
const source = createVaultPath('mentions.md');

describe('linkUnlinkedMention', () => {
  it('links the mention, keeps the frontmatter, and writes against the time it read', async () => {
    const { fs: vaultFs, writeTextFile } = writableVault(files['mentions.md'] ?? '');
    const linked = await linkUnlinkedMention({
      index: indexed,
      fs: vaultFs,
      markdown,
      openNotes: panes('closed'),
      source,
      target: atlas,
    });
    expect(linked).toBe(true);
    expect(writeTextFile).toHaveBeenCalledWith({
      path: source,
      contents: '---\ntype: doc\n---\nWe build [[Atlas|atlas]] here.\n',
      expectedModified: 7,
    });
  });

  it('reloads a pane holding the note with nothing unsaved', async () => {
    const open = panes('clean');
    await linkUnlinkedMention({
      index: indexed,
      fs: writableVault('Atlas').fs,
      markdown,
      openNotes: open,
      source,
      target: atlas,
    });
    expect(open.reload).toHaveBeenCalledWith(source);
  });

  it('refuses a note open with unsaved typing, and writes nothing', async () => {
    const { fs: vaultFs, writeTextFile } = writableVault('Atlas');
    await expect(
      linkUnlinkedMention({
        index: indexed,
        fs: vaultFs,
        markdown,
        openNotes: panes('dirty'),
        source,
        target: atlas,
      }),
    ).rejects.toBeInstanceOf(MentionNotLinkedError);
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it('refuses a chat note open with unsaved typing without naming it, since its name is the question', async () => {
    const refusal = linkUnlinkedMention({
      index: indexed,
      fs: writableVault('Atlas').fs,
      markdown,
      openNotes: panes('dirty'),
      source: createVaultPath('Chats/Should Mara Quill get a raise.md'),
      target: atlas,
    });
    await expect(refusal).rejects.toThrow('a chat note has unsaved changes. Save it first.');
  });

  it('writes nothing when the mention has gone, or is only in code', async () => {
    const { fs: vaultFs, writeTextFile } = writableVault('```\nAtlas\n```\n');
    const open = panes('clean');
    const linked = await linkUnlinkedMention({
      index: indexed,
      fs: vaultFs,
      markdown,
      openNotes: open,
      source,
      target: atlas,
    });
    expect(linked).toBe(false);
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(open.reload).not.toHaveBeenCalled();
  });
});

describe('linkUnlinkedMention — adversarial', () => {
  // `projects/Atlas.md` shares its name with `Atlas.md` at the top, and
  // `[[Atlas]]` opens the shallowest: the link made "to" the nested note opens
  // the other one, and the mention stays listed to be linked wrongly again.
  it('writes a link that opens the note it was asked to link to', async () => {
    const { fs: vaultFs, writeTextFile } = writableVault('We build Atlas here.\n');
    await linkUnlinkedMention({
      index: indexOf('Atlas.md', atlas.path, source),
      fs: vaultFs,
      markdown,
      openNotes: panes('closed'),
      source,
      target: atlas,
    });
    const written = (writeTextFile.mock.calls[0] as unknown as [{ contents: string }])[0].contents;
    const linkTarget = /\[\[([^\]|]+)/.exec(written)?.[1] ?? '';
    const vault = [createVaultPath('Atlas.md'), atlas.path, source];
    expect(resolveWikiLinkTarget(linkTarget, vault)).toBe(atlas.path);
  });
});
