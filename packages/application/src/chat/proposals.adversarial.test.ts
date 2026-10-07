import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { apiFixture } from '../testing/api-fixture.ts';
import { blockMarkdown } from '../testing/block-markdown.ts';
import { acceptProposal, proposeEdit, proposeNote } from './proposals.ts';

/**
 * Adversarial (A27-01, ADR-0021): a proposal names the exact path Accept
 * writes, that path is checked before the card is shown, and Accept writes
 * exactly the text the card was drawn from.
 */

const closed = { state: () => 'closed' as const, reload: () => {} };

function vault(files: Record<string, string>) {
  const fixture = apiFixture({ files, markdown: blockMarkdown() });
  const notePaths = [...fixture.files.keys()].map(createVaultPath);
  return { fixture, fs: fixture.fs, markdown: blockMarkdown(), notePaths };
}

describe('a proposed new note (adversarial)', () => {
  it.each([
    [{ title: 'Board', properties: { atlas: 'view' } }],
    [{ title: 'Home', properties: { atlas: 'dashboard' } }],
  ])('is refused when its kind would file it in hidden configuration: %j', (input) => {
    const { markdown } = vault({});
    expect(() => proposeNote({ markdown, input, id: 'n', notePaths: [] })).toThrow(
      /hidden configuration/,
    );
  });

  it.each([['Chats'], ['chats'], ['Chats/Old']])('is refused in the chats folder %s', (folder) => {
    const { markdown } = vault({});
    expect(() =>
      proposeNote({ markdown, input: { title: 'x', folder }, id: 'n', notePaths: [] }),
    ).toThrow(/Chats/);
  });

  it('names the path it will be written to, numbered past a note already there', () => {
    const { markdown, notePaths } = vault({ 'Projects/Idea.md': 'x' });
    const made = proposeNote({
      markdown,
      input: { title: 'Idea', folder: 'Projects' },
      id: 'n',
      notePaths,
    });
    expect(made.path).toBe('Projects/Idea 2.md');
  });

  it('is written at the path it named, and refused if that path was taken since', async () => {
    const { fs, markdown, fixture } = vault({});
    const made = proposeNote({
      markdown,
      input: { title: 'Idea', body: 'x' },
      id: 'n',
      notePaths: [],
    });
    await fs.createNote({ path: createVaultPath('Idea.md'), contents: 'someone else\n' });

    await expect(acceptProposal({ fs, openNotes: closed, proposal: made })).rejects.toThrow(
      /Idea\.md/,
    );
    expect([...fixture.files.keys()].filter((path) => path.startsWith('Idea'))).toEqual([
      'Idea.md',
    ]);
    expect(fixture.files.get('Idea.md')?.text).toBe('someone else\n');
  });
});

describe('a proposed edit (adversarial)', () => {
  it.each([['Chats/Talk.md'], ['chats/Talk.md']])(
    'is refused for the chat note %s',
    async (path) => {
      const { fs, markdown } = vault({ [path]: 'x\n' });
      await expect(
        proposeEdit({ fs, markdown, input: { path, append: 'y' }, id: 'p' }),
      ).rejects.toThrow(/Chats/);
    },
  );

  it('writes the text it was drawn from, frontmatter and all, when it sets a property', async () => {
    const { fs, markdown, fixture } = vault({ 'Plan.md': '---\nstatus: open\n---\n* one\n' });
    const made = await proposeEdit({
      fs,
      markdown,
      input: { path: 'Plan.md', append: '* two', properties: { status: 'done' } },
      id: 'p',
    });
    await acceptProposal({ fs, openNotes: closed, proposal: made });
    expect(fixture.files.get('Plan.md')?.text).toBe(made.contents);
    expect(made.contents).toMatch(/^---\nstatus: done\n---\n\* one\n\n\* two\n$/);
  });
});
