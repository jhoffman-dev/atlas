import { describe, expect, it } from 'vitest';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { notesInUseOfType } from './notes-in-use.ts';

describe('notesInUseOfType', () => {
  it('offers a type’s notes, leaving out archived ones', async () => {
    const index = fakeIndexPort({
      notesOfType: async () => [
        { path: 'Acme.md', title: 'Acme' },
        { path: 'Archive/Old Co.md', title: 'Old Co' },
      ],
    });
    expect(await notesInUseOfType({ index, type: 'company' })).toEqual([
      { path: 'Acme.md', title: 'Acme' },
    ]);
  });

  it('never offers the type’s template, or anything else in .atlas (issue #15)', async () => {
    const index = fakeIndexPort({
      notesOfType: async () => [
        { path: '.atlas/templates/Company.md', title: 'Company' },
        { path: '.atlas/sources/Companies.md', title: 'Companies' },
        { path: 'Acme.md', title: 'Acme' },
      ],
    });
    expect(await notesInUseOfType({ index, type: 'company' })).toEqual([
      { path: 'Acme.md', title: 'Acme' },
    ]);
  });
});
