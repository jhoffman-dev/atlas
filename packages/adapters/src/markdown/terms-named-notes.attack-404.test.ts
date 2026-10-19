/**
 * Adversarial pass on #404 (#400): a term named like a person or a company
 * adds its misheard spellings to that note's `variants`, and corrections read
 * them. Run end to end over a vault held in memory whose index answers with
 * real SQL, read and written through the real YAML adapter. All names are
 * made up.
 *
 * The invariants held here:
 * - a misheard spelling the add says it put somewhere corrects, to the right
 *   spelling that was typed;
 * - an add never loses what the note already said, nor reshapes it;
 * - a company's or a person's aliases never rewrite text;
 * - a meeting changes only where a misheard spelling stood.
 */
import { describe, expect, it } from 'vitest';
import {
  addTerm,
  importArrivedMeetings,
  loadTerms,
  recordingActivity,
  setTermVariants,
  TermRefusedError,
} from '@atlas/application';
import { automationVault } from '@atlas/application/testing/sqlite';
import {
  createVaultPath,
  digestOf,
  splitFrontmatter,
  type NoteChange,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';

const TODAY = '2026-10-19';
const markdown = remarkMarkdown;
const TERM: ObjectType = { name: 'term', label: 'Term', properties: [] };
const COMPANY_PATH = 'Areas/Vendors/Larkspur Payroll.md';
const NO_PANES = {
  setPropertiesIfOpen: async () => false,
};

const yamlNote = (lines: readonly string[], body = '\nPayroll vendor.\n') =>
  ['---', ...lines, '---', ''].join('\n') + body;

function setUp(notes: Record<string, string>) {
  const vault = automationVault({
    notes: { 'Terms/.keep.md': '', ...notes },
    today: TODAY,
    markdown,
  });
  const add = (
    term: { canonical: string; variants: string; kind?: 'product' | 'company' | null },
    openNotes: Parameters<typeof addTerm>[0]['openNotes'] = NO_PANES,
  ) =>
    addTerm({
      fs: vault.ports.fs,
      markdown,
      openNotes,
      today: TODAY,
      term: { kind: null, ...term },
      types: [TERM],
      templates: [],
      notePaths: vault.ports.notePaths.map((at) => createVaultPath(at)),
    });
  const corrections = async () => {
    const { vocabulary } = await loadTerms({ index: vault.ports.index });
    return new Map(vocabulary.entries.map((entry) => [entry.form, entry.canonical]));
  };
  const conflicts = async () => {
    const { vocabulary } = await loadTerms({ index: vault.ports.index });
    return vocabulary.conflicts.map((conflict) => conflict.form);
  };
  return { vault, add, corrections, conflicts };
}

const COMPANY = yamlNote([
  'type: company',
  'aliases:',
  '  - LP',
  'variants:',
  '  - Larkspar Payroll',
]);

describe('#404 where an add puts misheard spellings, they correct to what was typed', () => {
  it('never writes into an archived note, whose spellings the vocabulary never reads', async () => {
    const archived = 'Archive/Areas/Vendors/Larkspur Payroll.md';
    const { vault, add } = setUp({ [archived]: COMPANY });

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }).catch(
      (cause: unknown) => {
        if (!(cause instanceof TermRefusedError)) throw cause;
      },
    );

    expect(vault.files.get(archived)).toBe(COMPANY);
  });

  it('a spelling said to be added to a note corrects once added', async () => {
    const archived = 'Archive/Areas/Vendors/Larkspur Payroll.md';
    const { add, corrections } = setUp({ [archived]: COMPANY });

    const added = await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }).catch(
      (cause: unknown) => (cause instanceof TermRefusedError ? null : Promise.reject(cause)),
    );
    // Refusing is fine; saying it was added when it never corrects is not.
    const outcome = added === null ? 'refused' : (await corrections()).get('Lark Spur Payroll');
    expect(['refused', 'Larkspur Payroll']).toContain(outcome);
  });

  it('corrects to the right spelling typed, not to a namesake that differs only by case', async () => {
    const { add, corrections } = setUp({
      'Areas/Vendors/Larkspur.md': yamlNote(['type: company']),
    });

    await add({ canonical: 'LARKSPUR', variants: 'Lark Spur', kind: 'product' }).catch(
      (cause: unknown) => {
        if (!(cause instanceof TermRefusedError)) throw cause;
      },
    );

    // Refused, or corrected to what was typed; observed: corrected to `Larkspur`.
    expect([undefined, 'LARKSPUR']).toContain((await corrections()).get('Lark Spur'));
  });
});

describe('#404 an add keeps what the note already said', () => {
  it('appends to a list, every other byte of the note as it was', async () => {
    const { vault, add } = setUp({ [COMPANY_PATH]: COMPANY });

    const added = await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' });

    expect(added).toEqual({ path: COMPANY_PATH, into: 'company', added: ['Lark Spur Payroll'] });
    expect(vault.files.get(COMPANY_PATH)).toBe(
      COMPANY.replace('  - Larkspar Payroll\n', '  - Larkspar Payroll\n  - Lark Spur Payroll\n'),
    );
  });

  it('adding the same spellings twice writes once', async () => {
    const { vault, add } = setUp({ [COMPANY_PATH]: COMPANY });
    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' });
    const once = vault.files.get(COMPANY_PATH);

    const again = await add({ canonical: 'Larkspur Payroll', variants: 'Lark  Spur Payroll ' });

    expect(again.added).toEqual([]);
    expect(vault.files.get(COMPANY_PATH)).toBe(once);
  });

  it('adding again with some spellings new adds only those', async () => {
    const { vault, add } = setUp({ [COMPANY_PATH]: COMPANY });

    const added = await add({
      canonical: 'Larkspur Payroll',
      variants: 'Larkspar Payroll, Larks Burr Payroll',
    });

    expect(added.added).toEqual(['Larks Burr Payroll']);
    expect(vault.properties(COMPANY_PATH)['variants']).toEqual([
      'Larkspar Payroll',
      'Larks Burr Payroll',
    ]);
  });

  it('keeps an existing variant written decomposed (NFD) and does not add its composed twin', async () => {
    const decomposed = 'Lärkspur'.normalize('NFD');
    const text = yamlNote(['type: company', 'variants:', `  - ${decomposed}`]);
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    const added = await add({
      canonical: 'Larkspur Payroll',
      variants: 'Lärkspur'.normalize('NFC'),
    });

    expect(added.added).toEqual([]);
    expect(vault.files.get(COMPANY_PATH)).toBe(text);
  });

  it('a duplicated key elsewhere in the note leaves the file as it was', async () => {
    const text = yamlNote([
      'type: company',
      'tags: [vendor]',
      'tags: [payroll]',
      'variants:',
      '  - Larkspar Payroll',
    ]);
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }).catch(() => null);

    expect(vault.files.get(COMPANY_PATH)).toBe(text);
  });

  it('a company whose frontmatter repeats a key is refused for that, not told to rename', async () => {
    const text = yamlNote(['type: company', 'tags: [vendor]', 'tags: [payroll]']);
    const { add } = setUp({ [COMPANY_PATH]: text });

    const refusal = await add({
      canonical: 'Larkspur Payroll',
      variants: 'Lark Spur Payroll',
    }).then(
      () => '',
      (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
    );

    expect(refusal).not.toBe('');
    // Observed: "[[Larkspur Payroll]] already opens … would open the new term instead. Rename one of them first."
    expect(refusal).not.toMatch(/would open the new term/);
  });

  it('a duplicated variants key is refused, the file as it was (#376)', async () => {
    const text = yamlNote([
      'type: company',
      'variants: [Larkspar Payroll]',
      'variants: [Larks Burr Payroll]',
    ]);
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    await expect(
      add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }),
    ).rejects.toThrow();
    expect(vault.files.get(COMPANY_PATH)).toBe(text);
  });

  it('a variants that is a mapping, not a list, is not rewritten into another shape', async () => {
    const text = yamlNote(['type: company', 'variants:', '  heard: Larkspar Payroll']);
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }).catch(() => null);

    // Observed: the mapping becomes a list item, `- heard: Larkspar Payroll`.
    expect(vault.files.get(COMPANY_PATH)).not.toContain('  - heard: Larkspar Payroll');
  });

  it('a single variant written as a scalar becomes a list holding it and the new one', async () => {
    const text = yamlNote(['type: company', 'variants: Larkspar Payroll']);
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' });

    expect(vault.properties(COMPANY_PATH)['variants']).toEqual([
      'Larkspar Payroll',
      'Lark Spur Payroll',
    ]);
  });

  it('an empty variants scalar does not leave an empty spelling in the list', async () => {
    const text = yamlNote(['type: company', "variants: ''"]);
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' });

    expect(vault.properties(COMPANY_PATH)['variants']).toEqual(['Lark Spur Payroll']);
  });

  it('indented frontmatter (#394) keeps its other keys and gains the spelling', async () => {
    const text = yamlNote(['  type: company', '  site: https://larkspur.example']);
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }).catch(() => null);

    expect(vault.files.get(COMPANY_PATH)).toBe(
      yamlNote([
        '  type: company',
        '  site: https://larkspur.example',
        '  variants:',
        '    - Lark Spur Payroll',
      ]),
    );
  });

  it('a note with no frontmatter is not a company: nothing is written to it', async () => {
    const text = 'Payroll vendor.\n';
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }).catch(() => null);

    expect(vault.files.get(COMPANY_PATH)).toBe(text);
  });

  it('a change made outside the app between the read and the write is kept', async () => {
    const { vault, add } = setUp({ [COMPANY_PATH]: COMPANY });
    const read = vault.ports.fs.readTextFile;
    let reads = 0;
    vault.ports.fs.readTextFile = async (at: VaultPath) => {
      reads += 1;
      // After the add reads the note's type, someone else edits the body.
      if (reads === 2) vault.files.set(COMPANY_PATH, COMPANY + 'Renewal in March.\n');
      return read(at);
    };

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' });

    const after = vault.files.get(COMPANY_PATH) ?? '';
    expect(after).toContain('Renewal in March.');
    expect(after).toContain('Lark Spur Payroll');
  });
});

describe('#404 a note open in a pane', () => {
  it('merges against the pane’s unsaved properties, keeping a spelling typed there', async () => {
    const { vault, add } = setUp({ [COMPANY_PATH]: yamlNote(['type: company']) });
    const unsaved = { type: 'company', variants: ['Larkspar Payroll'] };
    const saved: unknown[] = [];
    const pane = {
      setPropertiesIfOpen: async ({
        values,
      }: Parameters<Parameters<typeof addTerm>[0]['openNotes']['setPropertiesIfOpen']>[0]) => {
        saved.push(typeof values === 'function' ? values(unsaved) : values);
        return true;
      },
    };

    const added = await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }, pane);

    expect(added.added).toEqual(['Lark Spur Payroll']);
    expect(saved).toEqual([{ variants: ['Larkspar Payroll', 'Lark Spur Payroll'] }]);
    expect(vault.files.get(COMPANY_PATH)).toBe(yamlNote(['type: company']));
  });
});

describe('#404 which note an add goes into', () => {
  it('a [company, person] note gains the spellings, and they correct to its name', async () => {
    const text = yamlNote(['type: [company, person]']);
    const { add, corrections } = setUp({ [COMPANY_PATH]: text });

    const added = await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' });

    expect(added.into).toBe('company');
    expect((await corrections()).get('Lark Spur Payroll')).toBe('Larkspur Payroll');
  });

  it('a [term, company] note is a term: its file is not written by the company path', async () => {
    const text = yamlNote(['type: [term, company]']);
    const { vault, add } = setUp({ [COMPANY_PATH]: text });

    await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' }).catch(
      (cause: unknown) => {
        if (!(cause instanceof TermRefusedError)) throw cause;
      },
    );

    expect(vault.files.get(COMPANY_PATH)).toBe(text);
  });

  it('when [[name]] opens several notes, only the one it opens is written', async () => {
    const deeper = 'Clients/Payroll/Larkspur Payroll.md';
    const { vault, add } = setUp({
      'Larkspur Payroll.md': COMPANY,
      [deeper]: yamlNote(['type: person']),
    });

    const added = await add({ canonical: 'Larkspur Payroll', variants: 'Lark Spur Payroll' });

    expect(added.path).toBe('Larkspur Payroll.md');
    expect(vault.files.get(deeper)).toBe(yamlNote(['type: person']));
  });

  it('a company name with no misheard spellings is refused and nothing is written', async () => {
    const { vault, add } = setUp({ [COMPANY_PATH]: COMPANY });

    await expect(add({ canonical: 'Larkspur Payroll', variants: ' , ' })).rejects.toBeInstanceOf(
      TermRefusedError,
    );
    expect(vault.files.get(COMPANY_PATH)).toBe(COMPANY);
  });
});

describe('#404 what corrects, and what never does', () => {
  it('two notes claiming one variant is a conflict, corrected neither way', async () => {
    const { conflicts, corrections } = setUp({
      [COMPANY_PATH]: yamlNote(['type: company', 'variants: [Larks]']),
      'People/Mara Quill.md': yamlNote(['type: person', 'variants: [Larks]']),
    });

    expect(await conflicts()).toContain('Larks');
    expect((await corrections()).has('Larks')).toBe(false);
  });

  it('a variant equal to another note’s name is a conflict, so the name is never rewritten', async () => {
    const { corrections } = setUp({
      [COMPANY_PATH]: yamlNote(['type: company', 'variants: [Mara Quill]']),
      'People/Mara Quill.md': yamlNote(['type: person']),
    });

    expect((await corrections()).has('Mara Quill')).toBe(false);
  });

  it('a variant equal to a term’s right spelling is a conflict, never corrected', async () => {
    const { corrections } = setUp({
      [COMPANY_PATH]: yamlNote(['type: company', 'variants: [Fenn Ledger]']),
      'Terms/Fenn Ledger.md': yamlNote(['type: term', 'variants: [Fen Ledger]']),
    });

    const known = await corrections();
    expect(known.has('Fenn Ledger')).toBe(false);
    expect(known.get('Fen Ledger')).toBe('Fenn Ledger');
  });

  it('a company’s aliases still never correct; only its variants do', async () => {
    const { corrections } = setUp({ [COMPANY_PATH]: COMPANY });

    const known = await corrections();
    expect(known.get('Larkspar Payroll')).toBe('Larkspur Payroll');
    expect(known.has('LP')).toBe(false);
  });

  it('variants are matched case-sensitively: the lowercase spelling is not corrected', async () => {
    const { corrections } = setUp({
      [COMPANY_PATH]: yamlNote(['type: company', 'variants: [Larkspar Payroll]']),
    });

    const known = await corrections();
    expect(known.has('larkspar payroll')).toBe(false);
  });

  it('a variant with leading and trailing spaces corrects as tidied', async () => {
    const { corrections } = setUp({
      [COMPANY_PATH]: yamlNote(['type: company', "variants: ['  Larkspar   Payroll ']"]),
    });

    expect((await corrections()).get('Larkspar Payroll')).toBe('Larkspur Payroll');
  });
});

describe('#404 the Terms page’s writes to a company row', () => {
  it('removing the last variant leaves the rest of the company note, and the row goes', async () => {
    const { vault } = setUp({ [COMPANY_PATH]: COMPANY });

    await setTermVariants({
      fs: vault.ports.fs,
      markdown,
      path: createVaultPath(COMPANY_PATH),
      variants: '',
      today: TODAY,
    });

    expect(vault.properties(COMPANY_PATH)).toMatchObject({ type: 'company', aliases: ['LP'] });
    const { listed } = await loadTerms({ index: vault.ports.index });
    expect(listed.map((row) => row.path)).not.toContain(COMPANY_PATH);
  });

  it('editing a company row whose note was deleted fails loudly and makes no note', async () => {
    const { vault } = setUp({ [COMPANY_PATH]: COMPANY });
    vault.files.delete(COMPANY_PATH);

    await expect(
      setTermVariants({
        fs: vault.ports.fs,
        markdown,
        path: createVaultPath(COMPANY_PATH),
        variants: 'Larks',
        today: TODAY,
      }),
    ).rejects.toThrow();
    expect(vault.files.has(COMPANY_PATH)).toBe(false);
  });
});

const STANDUP = 'Inbox/Meetings/2026-10-19 Standup.md';
const meetingFile = (body: string) =>
  [
    '---',
    'type: meeting',
    'atlas_import: meeting/v1',
    'title: Standup',
    "date: '2026-10-19'",
    "start: '09:30'",
    'provider: gemini',
    'external_id: gemini-404a',
    'attendees:',
    '  - name: Mara Quill',
    '    email: mara.quill@example.com',
    '---',
    body,
  ].join('\n');

const MEETING_BODY = [
  '',
  '## Summary',
  '',
  'Larkspar Payroll go-live moves a week; LP signs (L.P.) today. ^s1',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:00] Larkspar Payroll is late, says LP. ^t0001',
  '',
  '**Tobias Fenn** [~00:00:05] See [[Larkspar Payroll]]. ^t0002',
  '',
].join('\n');

describe('#404 a meeting arrives with a company’s variants corrected, end to end', () => {
  it('after adding the term from the Terms page, the variant corrects, the alias stays, nothing else moves', async () => {
    const company = yamlNote(['type: company', 'aliases:', '  - LP']);
    const { vault, add } = setUp({ [COMPANY_PATH]: company });
    await add({ canonical: 'Larkspur Payroll', variants: 'Larkspar Payroll' });
    vault.files.set(STANDUP, meetingFile(MEETING_BODY));
    const change: NoteChange = {
      kind: 'added',
      path: STANDUP,
      type: 'meeting',
      digest: digestOf(vault.files.get(STANDUP) ?? ''),
    };

    await importArrivedMeetings({
      ports: vault.ports,
      changes: [change],
      today: TODAY,
      activity: recordingActivity(),
    });

    const body = splitFrontmatter(vault.files.get(STANDUP) ?? '').body;
    expect(body).toBe(MEETING_BODY.replace(/Larkspar Payroll(?!\]\])/g, 'Larkspur Payroll'));
  });
});
