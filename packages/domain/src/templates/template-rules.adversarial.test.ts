import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { isVisibleEntry } from '../vault/vault-visibility.ts';
import { templateNameProblem, templateUses } from './template-rules.ts';

/**
 * Adversarial probes of the template rules (issue #16, ADR-0026). Each test
 * names the invariant it holds the rules to.
 */

describe('what a template says it is used for', () => {
  it('names every type it serves, not only the first', () => {
    // A type relabelled from Person to Contact keeps the name `person`; a new
    // type labelled Person then gets another name. Person.md serves both —
    // by label for one, by name for the other — so editing it changes what
    // both start as, and the band and the Templates page must say so.
    const contact = { name: 'person', label: 'Contact' };
    const person = { name: 'person_2', label: 'Person' };
    const uses = templateUses('Person', [contact, person]);
    expect(uses).toEqual([
      { kind: 'type', typeName: 'person', typeLabel: 'Contact' },
      { kind: 'type', typeName: 'person_2', typeLabel: 'Person' },
    ]);
  });
});

describe('the templates folder leaves user space whatever its case', () => {
  it('hides .atlas/Templates, which the Mac’s disk takes for .atlas/templates', () => {
    // On a case-insensitive disk the Templates page lists this file (through
    // `.atlas/templates`) while the tree, link resolution and the index still
    // read it as an ordinary note — issue #15's trap, back again.
    const path = createVaultPath('.atlas/Templates/Company.md');
    expect(isVisibleEntry({ kind: 'file', name: 'Company.md', path })).toBe(false);
  });
});

describe('a template’s name', () => {
  it('refuses a trailing dot, which the vault’s own note names never keep', () => {
    // cleanEntryName strips a trailing dot from every note name because it
    // "confuses some filesystems"; a template is a note too.
    expect(templateNameProblem({ name: 'Person.', takenPaths: [] })).not.toBeNull();
  });
});
