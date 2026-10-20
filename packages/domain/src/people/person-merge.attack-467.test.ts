import { describe, expect, it } from 'vitest';
import { notesAfterMerge, retargetMergedLinks } from '../markdown/retarget-links.ts';
import { matchAttendees, type DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { planPersonMerge } from './person-merge-plan.ts';
import { possibleDuplicates } from './possible-duplicates.ts';

/*
 * Adversarial probes of PR #467 (merge duplicate people, #464). Fictional
 * names only. Each test names the invariant it holds the merge to.
 */

const p = createVaultPath;

function rewriteAcross(notes: readonly VaultPath[], merged: VaultPath, kept: VaultPath) {
  const across = notesAfterMerge({ notes, into: new Map([[merged, kept]]) });
  return (text: string) => retargetMergedLinks({ text, ...across });
}

describe('merging two notes of the same title in different folders (attack-467)', () => {
  const root = p('Tobias Fenn.md');
  const filed = p('People/Tobias Fenn.md');
  const clients = p('Clients/Tobias Fenn.md');

  it('a path-qualified link to the merged copy ends at the kept copy', () => {
    const rewrite = rewriteAcross([root, filed, p('Deal.md')], filed, root);
    const { text } = rewrite('Signed by [[People/Tobias Fenn|Tobias]].');
    expect(text).toBe('Signed by [[Tobias Fenn|Tobias]].');
  });

  it('a bare link opening the merged copy opens the kept copy, with a third namesake present', () => {
    const rewrite = rewriteAcross([root, filed, clients], root, filed);
    const { text } = rewrite('Signed by [[Tobias Fenn]] and [[Clients/Tobias Fenn]].');
    expect(text).toBe('Signed by [[People/Tobias Fenn]] and [[Clients/Tobias Fenn]].');
  });
});

describe('links the merge must not touch (attack-467)', () => {
  const kept = p('People/Mara Quill.md');
  const short = p('Mara.md');
  const rewrite = rewriteAcross([kept, short, p('Mara Quillon.md')], short, kept);

  it('leaves a link inside a fenced code block or a code span byte for byte', () => {
    const text = 'See:\n\n```\n[[Mara]]\n```\n\nand `[[Mara]]` inline.\n';
    expect(rewrite(text)).toEqual({ text, count: 0 });
  });

  it('leaves a longer name that starts with the merged one alone', () => {
    const text = '[[Mara Quillon]] and [[Mara Quillon|MQ]]';
    expect(rewrite(text)).toEqual({ text, count: 0 });
  });
});

describe('meeting import after a merge (attack-467)', () => {
  const person = (
    name: string,
    path: string,
    fields: Partial<Pick<DirectoryPerson, 'emails' | 'aliases'>>,
  ): DirectoryPerson => ({
    path: p(path),
    name,
    emails: fields.emails ?? [],
    aliases: fields.aliases ?? [],
    company: null,
  });

  it('keeps a merged person’s +tag address, so import still finds the kept person by it', () => {
    const kept = {
      path: p('People/Mara Quill.md'),
      properties: { type: 'person', email: 'mara@larkspur.example' },
      body: '',
    };
    const duplicate = {
      path: p('Inbox/mara+payroll.md'),
      properties: { type: 'person', email: 'mara+payroll@larkspur.example' },
      body: '',
    };
    const plan = planPersonMerge({ kept, duplicates: [duplicate] });
    const emails = [
      'mara@larkspur.example',
      ...((plan.changes['other_emails'] as string[] | undefined) ?? []),
    ];
    const aliases = (plan.changes['aliases'] as string[] | undefined) ?? [];
    const merged = person('Mara Quill', 'People/Mara Quill.md', { emails, aliases });
    const matching = matchAttendees(
      [{ name: 'Payroll desk', email: 'mara+payroll@larkspur.example', group: false }],
      [merged],
      [],
    );
    expect(matching.linked.map(({ person: found }) => found.path)).toEqual([merged.path]);
  });
});

describe('the possible-duplicates list (attack-467)', () => {
  const candidate = (path: string, name: string, emails: string[]) => ({
    path: p(path),
    name,
    emails,
    aliases: [],
  });

  it('does not pair two public-mail users whose addresses are one letter apart', () => {
    const pairs = possibleDuplicates({
      people: [
        candidate('People/Chris Wong.md', 'Chris Wong', ['chris.wong@gmail.com']),
        candidate('People/Chris Wang.md', 'Chris Wang', ['chris.wang@gmail.com']),
      ],
      dismissed: new Set(),
    });
    expect(pairs).toEqual([]);
  });

  it('does not pair the same local part at two different public mail providers', () => {
    const pairs = possibleDuplicates({
      people: [
        candidate('People/Ana Lind.md', 'Ana Lind', ['ana.lind@mail.com']),
        candidate('People/Ana Lindqvist.md', 'Ana Lindqvist', ['ana.lind@gmail.com']),
      ],
      dismissed: new Set(),
    });
    expect(pairs).toEqual([]);
  });

  it('pairs one name written in composed and decomposed Unicode', () => {
    const pairs = possibleDuplicates({
      people: [
        candidate('José Ortiz.md', 'José Ortiz', []),
        candidate('People/José Ortiz.md', 'José Ortiz', []),
      ],
      dismissed: new Set(),
    });
    expect(pairs.map((pair) => pair.reasons[0]?.kind)).toEqual(['same-name']);
  });
});

describe('what a merge keeps of a merged person’s properties (attack-467)', () => {
  const kept = (properties: Record<string, unknown>) => ({
    path: p('People/Mara Quill.md'),
    properties: { type: 'person', ...properties },
    body: '',
  });
  const duplicate = (properties: Record<string, unknown>) => ({
    path: p('Mara.md'),
    properties,
    body: '',
  });

  it('keeps or lists every other type a merged person has, never dropping one unseen', () => {
    const plan = planPersonMerge({
      kept: kept({}),
      duplicates: [duplicate({ type: ['person', 'contractor'] })],
    });
    const listed = plan.conflicts.some((conflict) => conflict.key === 'type');
    const taken = JSON.stringify(plan.changes['type'] ?? null).includes('contractor');
    expect(listed || taken).toBe(true);
  });

  it('joins a merged list into a kept single value rather than dropping its other items', () => {
    const plan = planPersonMerge({
      kept: kept({ team: 'Payroll' }),
      duplicates: [duplicate({ type: 'person', team: ['Payroll', 'Tax'] })],
    });
    expect(plan.changes['team']).toEqual(['Payroll', 'Tax']);
  });
});
