import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { addTerm } from './terms.ts';

/*
 * Adversarial (P28-05): a term's right spelling is its title, and the index
 * takes a note's title from its `title:` before its file name. A Term template
 * whose frontmatter carries a `title:` hands that title to every term added
 * from the Terms page, unless the new term's own spelling replaces it.
 */

const TEMPLATE = createVaultPath('.atlas/templates/Term.md');

describe('adding a term from a Term template that has a title of its own', () => {
  it('leaves the term titled by its own spelling, not the template’s', async () => {
    const created: { path: string; contents: string }[] = [];
    const fs = fakeVaultFs({
      listDirectory: async () => [
        { name: 'Terms', path: createVaultPath('Terms'), kind: 'directory' },
      ],
      readTextFile: async () => ({ text: '---\ntitle: New term\ntype: term\n---\n', modified: 1 }),
      createNote: async ({ path, contents }) => {
        created.push({ path, contents });
      },
    });

    const made = await addTerm({
      fs,
      markdown: fakeMarkdown(),
      term: { canonical: 'Larkspur', variants: 'lark spur', kind: 'company' },
      types: [],
      templates: [{ path: TEMPLATE, name: 'Term' }],
      notePaths: [],
    });

    expect(made).toBe('Terms/Larkspur.md');
    const contents = created[0]?.contents ?? '';
    expect(contents).toContain('type: term');
    expect(contents).not.toMatch(/^title: New term$/m);
  });
});
