/**
 * #404's verification: what an add of a term named like a person or a
 * company does with a note whose properties are not plain, read and written
 * through the real YAML adapter over a vault held in memory. Names are made up.
 */
import { describe, expect, it } from 'vitest';
import { addTerm, loadTerms, TermRefusedError } from '@dfai/application';
import { automationVault } from '@dfai/application/testing/sqlite';
import { createVaultPath, type ObjectType } from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';

const TODAY = '2026-10-19';
const TERM: ObjectType = { name: 'term', label: 'Term', properties: [] };
const COMPANY_PATH = 'Areas/Vendors/Larkspur Payroll.md';

const yamlNote = (lines: readonly string[]) =>
  ['---', ...lines, '---', '', 'Payroll vendor.', ''].join('\n');

function setUp(notes: Record<string, string>) {
  const vault = automationVault({
    notes: { 'Terms/.keep.md': '', ...notes },
    today: TODAY,
    markdown: remarkMarkdown,
  });
  const add = (canonical: string, variants = 'Lark Spur Payroll') =>
    addTerm({
      fs: vault.ports.fs,
      markdown: remarkMarkdown,
      openNotes: { setPropertiesIfOpen: async () => false },
      today: TODAY,
      term: { canonical, variants, kind: null },
      types: [TERM],
      templates: [],
      notePaths: vault.ports.notePaths.map((at) => createVaultPath(at)),
    });
  const refusalOf = (canonical: string) =>
    add(canonical).then(
      () => '',
      (cause: unknown) => {
        if (!(cause instanceof TermRefusedError)) throw cause;
        return cause.message;
      },
    );
  const terms = () =>
    [...vault.files.keys()].filter((at) => at.startsWith('Terms/') && at !== 'Terms/.keep.md');
  return { vault, add, refusalOf, terms };
}

describe('a company titled other than its file name (#404)', () => {
  const TITLED = yamlNote(['type: company', 'title: Larkspur Payroll Co']);

  it('is refused with advice that, followed, adds to the company and makes no second term', async () => {
    const { vault, add, refusalOf, terms } = setUp({ [COMPANY_PATH]: TITLED });

    const refusal = await refusalOf('Larkspur Payroll');
    // Adding the term under the title would make Terms/Larkspur Payroll Co.md, beside the company.
    expect(refusal).not.toMatch(/Add the term as/);
    expect(refusal).toBe(
      `${COMPANY_PATH} is titled “Larkspur Payroll Co”, but [[Larkspur Payroll]] opens it by its file name. Rename the note or change its title so the two agree, then add the term again.`,
    );
    expect(vault.files.get(COMPANY_PATH)).toBe(TITLED);
    expect(terms()).toEqual([]);

    // Following it: the title changed to agree with the file name.
    (vault.files as Map<string, string>).set(
      COMPANY_PATH,
      TITLED.replace('title: Larkspur Payroll Co', 'title: Larkspur Payroll'),
    );
    expect(await add('Larkspur Payroll')).toMatchObject({ path: COMPANY_PATH, into: 'company' });
    expect(terms()).toEqual([]);
    const { vocabulary } = await loadTerms({ index: vault.ports.index });
    expect(vocabulary.conflicts).toEqual([]);
    expect(vocabulary.entries.find((entry) => entry.form === 'Lark Spur Payroll')?.canonical).toBe(
      'Larkspur Payroll',
    );
  });
});

describe('a note whose properties cannot be read (#404)', () => {
  it('is refused with the reason, rather than given a term beside it', async () => {
    const broken = yamlNote(['type: company', 'tags: [unclosed']);
    const { vault, refusalOf, terms } = setUp({ [COMPANY_PATH]: broken });

    const refusal = await refusalOf('Larkspur Payroll');

    expect(refusal).toMatch(
      new RegExp(`^${COMPANY_PATH} has properties DFAI can't change safely: `),
    );
    expect(vault.files.get(COMPANY_PATH)).toBe(broken);
    expect(terms()).toEqual([]);
  });

  it('refuses a company whose type is repeated, naming the key, since which type it is would be a guess', async () => {
    const twice = yamlNote(['type: company', 'type: term']);
    const { vault, refusalOf, terms } = setUp({ [COMPANY_PATH]: twice });

    expect(await refusalOf('Larkspur Payroll')).toMatch(/"type" twice/);
    expect(vault.files.get(COMPANY_PATH)).toBe(twice);
    expect(terms()).toEqual([]);
  });
});
