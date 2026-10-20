import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  mergedBody,
  personMergeRefusal,
  planPersonMerge,
  type MergeNote,
} from './person-merge-plan.ts';

const note = (path: string, properties: Record<string, unknown> = {}, body = ''): MergeNote => ({
  path: createVaultPath(path),
  properties: { type: 'person', ...properties },
  body,
});

const kept = (properties: Record<string, unknown> = {}, body = '') =>
  note('People/Mara Quill.md', properties, body);

describe('what merging people changes in the kept note', () => {
  it('joins lists, keeping the kept note’s items first and never one twice', () => {
    const plan = planPersonMerge({
      kept: kept({ projects: ['[[Payroll]]', '[[Onboarding]]'] }),
      duplicates: [note('Mara.md', { projects: ['[[payroll]]', '[[Audit]]'] })],
    });
    expect(plan.changes['projects']).toEqual(['[[Payroll]]', '[[Onboarding]]', '[[Audit]]']);
    expect(plan.conflicts).toEqual([]);
  });

  it('takes a value the kept note has none of, from the first merged note that has one', () => {
    const plan = planPersonMerge({
      kept: kept({ role: '', phone: null }),
      duplicates: [
        note('Mara.md', { role: 'Payroll lead' }),
        note('Marra Quill.md', { role: 'Analyst', phone: '555-0100' }),
      ],
    });
    expect(plan.changes).toMatchObject({ role: 'Payroll lead', phone: '555-0100' });
    expect(plan.conflicts).toEqual([
      {
        key: 'role',
        kept: 'Payroll lead',
        other: 'Analyst',
        from: 'Marra Quill.md',
      },
    ]);
  });

  it('keeps the kept note’s single value where they differ, and lists the other', () => {
    const plan = planPersonMerge({
      kept: kept({ company: '[[Larkspur Payroll]]', started: 2024 }),
      duplicates: [note('Mara.md', { company: '[[Fenn & Co]]', started: 2024 })],
    });
    expect(plan.changes).toEqual({ aliases: ['Mara'] });
    expect(plan.conflicts).toEqual([
      { key: 'company', kept: '[[Larkspur Payroll]]', other: '[[Fenn & Co]]', from: 'Mara.md' },
    ]);
  });

  it('reads a single value the same as another, case and spacing aside, as no conflict', () => {
    const plan = planPersonMerge({
      kept: kept({ company: '[[Larkspur Payroll]]' }),
      duplicates: [note('Mara.md', { company: '[[larkspur  payroll]]' })],
    });
    expect(plan.conflicts).toEqual([]);
    expect(Object.keys(plan.changes)).toEqual(['aliases']);
  });

  it('adds a merged single value to a kept list, and joins a merged list to a kept single value', () => {
    const plan = planPersonMerge({
      kept: kept({ teams: ['Payroll'], lead: '[[Tobias Fenn]]', desk: 'North' }),
      duplicates: [
        note('Mara.md', { teams: 'Audit', lead: ['[[Tobias Fenn]]'], desk: ['North', 'South'] }),
      ],
    });
    expect(plan.changes['teams']).toEqual(['Payroll', 'Audit']);
    expect(plan.changes['lead']).toBeUndefined();
    expect(plan.changes['desk']).toEqual(['North', 'South']);
    expect(plan.conflicts).toEqual([]);
  });

  it('joins every type, the kept note’s first, and leaves one type as it was written', () => {
    const plan = planPersonMerge({
      kept: kept(),
      duplicates: [
        note('Mara.md', { type: ['person', 'contact'] }),
        note('M.md', { type: 'vendor' }),
      ],
    });
    expect(plan.changes['type']).toEqual(['person', 'contact', 'vendor']);
    const same = planPersonMerge({
      kept: kept(),
      duplicates: [note('Mara.md', { type: 'Person' })],
    });
    expect(same.changes['type']).toBeUndefined();
    expect(same.conflicts).toEqual([]);
  });

  it('leaves out a merged value that is only a link to the kept person or a merged one', () => {
    const opens: Record<string, string> = {
      'Mara Quill': 'People/Mara Quill.md',
      Mara: 'Mara.md',
      'Tobias Fenn': 'Tobias Fenn.md',
    };
    const plan = planPersonMerge({
      kept: kept({ related: ['[[Tobias Fenn]]'] }),
      duplicates: [
        note('Mara.md', {
          same_as: '[[Mara Quill]]',
          related: ['[[Mara|me]]', '[[Tobias Fenn]]', '[[Mara Quill]] and more'],
        }),
      ],
      resolve: (target) => (opens[target] === undefined ? null : createVaultPath(opens[target])),
    });
    expect(plan.changes['same_as']).toBeUndefined();
    expect(plan.changes['related']).toEqual(['[[Tobias Fenn]]', '[[Mara Quill]] and more']);
  });

  it('skips a merged value that is empty, as an empty list or text of spaces', () => {
    const plan = planPersonMerge({
      kept: kept({ role: 'Lead' }),
      duplicates: [note('Mara.md', { role: '  ', teams: [], notes: [null, ''] })],
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toEqual({ aliases: ['Mara'] });
  });
});

describe('addresses in a merge', () => {
  it('adds each merged address the kept note lacks to other_emails, never one twice', () => {
    const plan = planPersonMerge({
      kept: kept({
        email: 'mara.quill@larkspur.example.com',
        other_emails: ['mq@larkspur.example.com'],
      }),
      duplicates: [
        note('Mara.md', {
          email: 'Mara@larkspur.example.com',
          other_emails: ['MQ@larkspur.example.com', 'mara+lists@larkspur.example.com'],
        }),
        note('Marra Quill.md', { email: 'marra.quill@larkspur.example.com' }),
      ],
    });
    expect(plan.changes['email']).toBeUndefined();
    // Exactly as written, case aside: a +tag address is an address of its own.
    expect(plan.changes['other_emails']).toEqual([
      'mq@larkspur.example.com',
      'Mara@larkspur.example.com',
      'mara+lists@larkspur.example.com',
      'marra.quill@larkspur.example.com',
    ]);
    expect(plan.emailsAdded).toEqual([
      'Mara@larkspur.example.com',
      'mara+lists@larkspur.example.com',
      'marra.quill@larkspur.example.com',
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('gives a kept note with no address the first merged one as its email', () => {
    const plan = planPersonMerge({
      kept: kept(),
      duplicates: [
        note('Mara.md', { email: 'mara@larkspur.example.com' }),
        note('Marra.md', { other_emails: 'marra@larkspur.example.com' }),
      ],
    });
    expect(plan.changes['email']).toBe('mara@larkspur.example.com');
    expect(plan.changes['other_emails']).toEqual(['marra@larkspur.example.com']);
  });

  it('writes no address key when every merged address is already held', () => {
    const plan = planPersonMerge({
      kept: kept({ email: 'mara@larkspur.example.com' }),
      duplicates: [note('Mara.md', { email: ' MARA@larkspur.example.com ' })],
    });
    expect(plan.changes['email']).toBeUndefined();
    expect(plan.changes['other_emails']).toBeUndefined();
    expect(plan.emailsAdded).toEqual([]);
  });
});

describe('aliases in a merge', () => {
  it('adds each merged note’s title and aliases, but not the kept note’s own name', () => {
    const plan = planPersonMerge({
      kept: kept({ aliases: ['MQ'] }),
      duplicates: [
        note('Mara.md', { aliases: ['mq', 'Mara Q', 'Mara Quill'] }),
        note('Inbox/Mara Quill.md', { aliases: 'M. Quill' }),
      ],
    });
    expect(plan.changes['aliases']).toEqual(['MQ', 'Mara', 'Mara Q', 'M. Quill']);
    expect(plan.aliasesAdded).toEqual(['Mara', 'Mara Q', 'M. Quill']);
  });
});

describe('bodies in a merge', () => {
  it('appends each merged body under a heading naming it, the kept body’s bytes untouched', () => {
    const plan = planPersonMerge({
      kept: kept({}, '# Mara Quill\n\nLeads payroll.'),
      duplicates: [
        note('Mara.md', {}, '\n\nMet at the [[Kickoff]].\n\n'),
        note('Empty.md', {}, ' \n'),
      ],
    });
    expect(plan.appended).toEqual([
      { from: 'Mara.md', heading: '## Merged from Mara', body: 'Met at the [[Kickoff]].' },
    ]);
    expect(mergedBody('# Mara Quill\n\nLeads payroll.', plan.appended)).toBe(
      '# Mara Quill\n\nLeads payroll.\n\n## Merged from Mara\n\nMet at the [[Kickoff]].\n',
    );
  });

  it('adds a merged body the kept note already holds under its heading once, never twice', () => {
    const merged = note('Mara.md', {}, 'Met at the kickoff.\n');
    const once = planPersonMerge({ kept: kept({}, 'Leads.\n'), duplicates: [merged] });
    const body = mergedBody('Leads.\n', once.appended);
    const again = planPersonMerge({ kept: kept({}, body), duplicates: [merged] });
    expect(again.appended).toEqual([]);
    const changed = planPersonMerge({
      kept: kept({}, body),
      duplicates: [note('Mara.md', {}, 'Met at the kickoff, then lunch.\n')],
    });
    expect(changed.appended).toHaveLength(1);
  });

  it('names a merged note by its path where its title is the kept note’s too', () => {
    const plan = planPersonMerge({
      kept: note('People/Tobias Fenn.md'),
      duplicates: [note('Tobias Fenn.md', {}, 'Root copy.')],
    });
    expect(plan.appended[0]?.heading).toBe('## Merged from Tobias Fenn');
    const twin = planPersonMerge({
      kept: note('People/Tobias Fenn.md'),
      duplicates: [note('Inbox/Tobias Fenn.md', {}, 'Inbox copy.')],
    });
    expect(twin.appended[0]?.heading).toBe('## Merged from Inbox/Tobias Fenn');
  });

  it('keeps a body’s line endings: CRLF stays CRLF, an empty body gets no blank line first', () => {
    const appended = [{ from: createVaultPath('A.md'), heading: '## Merged from A', body: 'x\ny' }];
    expect(mergedBody('Kept\r\n', appended)).toBe('Kept\r\n\r\n## Merged from A\r\n\r\nx\r\ny\r\n');
    expect(mergedBody('', appended)).toBe('## Merged from A\n\nx\ny\n');
    expect(mergedBody('Kept', [])).toBe('Kept');
  });
});

describe('what cannot be merged', () => {
  const mara = note('Mara.md');

  it('refuses no duplicates, the kept note among them, or one listed twice', () => {
    expect(personMergeRefusal({ kept: kept(), duplicates: [] })).toBe(
      'Pick at least one person to merge.',
    );
    expect(personMergeRefusal({ kept: mara, duplicates: [mara] })).toBe(
      'Mara cannot be merged into itself.',
    );
    expect(personMergeRefusal({ kept: kept(), duplicates: [mara, mara] })).toBe(
      'A person is listed twice.',
    );
  });

  it('refuses a note that is not a person, and accepts one of several types', () => {
    const project = { path: createVaultPath('Payroll.md'), properties: { type: 'project' } };
    expect(personMergeRefusal({ kept: kept(), duplicates: [project] })).toBe(
      'Payroll is not a person.',
    );
    const both = { path: createVaultPath('M.md'), properties: { type: ['contact', 'person'] } };
    expect(personMergeRefusal({ kept: kept(), duplicates: [both] })).toBeNull();
  });
});
