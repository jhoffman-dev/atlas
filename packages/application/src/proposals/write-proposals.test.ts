import { describe, expect, it } from 'vitest';
import type { NewProposal, VaultPath } from '@dfai/domain';
import { jsonLinesMarkdown, jsonLinesNote, proposalVault } from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { planProposals, writeProposals } from './write-proposals.ts';

const proposal = (id: string, name: string): NewProposal => ({
  kind: 'task',
  confidence: null,
  source: null,
  madeBy: 'test',
  id,
  name,
  reason: 'Because.',
  payload: { title: name, folder: null, properties: {}, body: '', linkFrom: null },
});

/** A vault whose index holds `indexed` — all of `files` unless said: it may lag them. */
function vault(files: Record<string, string>, indexed: Record<string, string> = files) {
  const setup = proposalVault(files);
  const index = {
    ...setup.ports.index,
    query: atlasQueryIndex({ files: indexed, markdown: jsonLinesMarkdown() }),
  };
  return { setup, ports: { fs: setup.ports.fs, markdown: setup.ports.markdown, index } };
}

describe('writeProposals', () => {
  /** A vault where another run writes `contents` at a proposal's path just before this run does. */
  function racedBy(contents: (planned: string) => string) {
    const { setup, ports } = vault({});
    const create = ports.fs.createNote;
    const fs = {
      ...ports.fs,
      createNote: async (note: { path: VaultPath; contents: string }) => {
        await create({ path: note.path, contents: contents(note.contents) });
        return create(note);
      },
    };
    return { setup, ports: { ...ports, fs } };
  }

  it('writes a proposal two runs make at once only once, and the second says nothing failed', async () => {
    const { setup, ports } = racedBy((planned) => planned);

    const written = await writeProposals({ ...ports, proposals: [proposal('a', 'Brenwick')] });

    expect(written).toEqual({ written: [], left: [] });
    expect(setup.propertiesOf('Inbox/Proposals/Brenwick.md')).toMatchObject({ proposal_id: 'a' });
  });

  it('still says why when what took its path at that moment is another proposal', async () => {
    const { ports } = racedBy(() => jsonLinesNote({ type: 'proposal', proposal_id: 'b' }));

    const written = await writeProposals({ ...ports, proposals: [proposal('a', 'Brenwick')] });

    expect(written.written).toEqual([]);
    expect(written.left.map((each) => each.path)).toEqual(['Inbox/Proposals/Brenwick.md']);
  });

  it('writes each as an open proposal, numbering a name another note has, making the folder', async () => {
    const { setup, ports } = vault({
      'Inbox/Proposals/Call Ada.md': jsonLinesNote({ type: 'task' }),
    });
    const written = await writeProposals({
      ...ports,
      proposals: [proposal('a', 'Call Ada'), proposal('b', 'Call Ada')],
    });
    expect(written).toEqual({
      written: ['Inbox/Proposals/Call Ada 2.md', 'Inbox/Proposals/Call Ada 3.md'],
      left: [],
    });
    expect(setup.propertiesOf('Inbox/Proposals/Call Ada 2.md')).toMatchObject({
      type: 'proposal',
      state: 'open',
      proposal_id: 'a',
    });
  });

  it('writes nothing for an id the vault holds, the Archive included', async () => {
    const { ports } = vault({
      'Archive/Inbox/Proposals/Old.md': jsonLinesNote({ type: 'proposal', proposal_id: 'a' }),
    });
    expect(await writeProposals({ ...ports, proposals: [proposal('a', 'Call Ada')] })).toEqual({
      written: [],
      left: [],
    });
  });

  it('writes nothing for an id a proposal waiting in the folder holds, before the index knows it', async () => {
    const waiting = {
      'Inbox/Proposals/Call Ada 7.md': jsonLinesNote({ type: 'proposal', proposal_id: 'a' }),
    };
    const { ports } = vault(waiting, {});
    expect(await writeProposals({ ...ports, proposals: [proposal('a', 'Call Ada')] })).toEqual({
      written: [],
      left: [],
    });
  });

  it('passes on a fault reading the folder', async () => {
    const { ports } = vault({});
    const fs = { ...ports.fs, listDirectory: async () => Promise.reject(new Error('denied')) };
    await expect(writeProposals({ ...ports, fs, proposals: [proposal('a', 'X')] })).rejects.toThrow(
      'denied',
    );
  });

  it('says which could not be written, and writes the rest', async () => {
    const { ports } = vault({});
    const fs = {
      ...ports.fs,
      createNote: async (args: { path: VaultPath; contents: string }) => {
        if (args.path.includes('Refused')) throw new Error('The disk said no.');
        await ports.fs.createNote(args);
        return 0;
      },
    };
    const outcome = await writeProposals({
      ...ports,
      fs,
      proposals: [proposal('a', 'Refused'), proposal('b', 'Fine')],
    });
    expect(outcome).toEqual({
      written: ['Inbox/Proposals/Fine.md'],
      left: [{ path: 'Inbox/Proposals/Refused.md', reason: 'The disk said no.' }],
    });
  });

  it('writes nothing, and asks nothing, when there is nothing to propose', async () => {
    const { ports } = vault({});
    const index = { ...ports.index, query: async () => Promise.reject(new Error('asked')) };
    expect(await writeProposals({ ...ports, index, proposals: [] })).toEqual({
      written: [],
      left: [],
    });
  });
});

describe('planProposals', () => {
  it('decides every proposal — name, contents — and writes none of them', async () => {
    const { setup, ports } = vault({
      'Inbox/Proposals/Call Ada.md': jsonLinesNote({ type: 'task' }),
    });
    const before = setup.paths();

    const { planned, left } = await planProposals({
      ...ports,
      proposals: [proposal('a', 'Call Ada'), proposal('b', 'Call Ada'), proposal('c', 'Pay Bo')],
    });

    expect(left).toEqual([]);
    expect(planned.map(({ path }) => path)).toEqual([
      'Inbox/Proposals/Call Ada 2.md',
      'Inbox/Proposals/Call Ada 3.md',
      'Inbox/Proposals/Pay Bo.md',
    ]);
    expect(planned[0]!.contents).toContain('proposal_id: "a"');
    expect(planned[0]!.contents).toContain('Because.');
    expect(setup.paths()).toEqual(before);
  });

  it('plans one proposal for an id given twice in the same batch', async () => {
    const { ports } = vault({});
    const { planned } = await planProposals({
      ...ports,
      proposals: [proposal('a', 'Call Ada'), proposal('a', 'Call Ada again')],
    });
    expect(planned.map(({ path }) => path)).toEqual(['Inbox/Proposals/Call Ada.md']);
  });

  it('leaves room in a long name for the number a taken name is given', async () => {
    const long = 'é'.repeat(200);
    const { ports } = vault({});
    const { planned } = await planProposals({
      ...ports,
      proposals: [proposal('a', long), proposal('b', long)],
    });
    const names = planned.map(({ path }) => path.slice('Inbox/Proposals/'.length));
    expect(names[1]).toMatch(/ 2\.md$/);
    for (const name of names)
      expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
    expect(names[0]!.length).toBeGreaterThan(100);
  });

  it('says a proposal that cannot be made a note of, and plans the rest', async () => {
    const { ports } = vault({});
    const markdown = {
      ...ports.markdown,
      updateFrontmatter: (frontmatter: string | null, changes: Record<string, unknown>) => {
        if (changes['proposal_id'] === 'a') throw new Error('It does not serialize.');
        return ports.markdown.updateFrontmatter(frontmatter, changes);
      },
    };
    const { planned, left } = await planProposals({
      ...ports,
      markdown,
      proposals: [proposal('a', 'Bad'), proposal('b', 'Fine')],
    });
    expect(planned.map(({ path }) => path)).toEqual(['Inbox/Proposals/Fine.md']);
    expect(left).toEqual([{ path: 'Inbox/Proposals/Bad.md', reason: 'It does not serialize.' }]);
  });
});
