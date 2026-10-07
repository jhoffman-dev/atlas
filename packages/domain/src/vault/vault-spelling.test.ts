import { describe, expect, it } from 'vitest';
import { createVaultPath } from './vault-path.ts';
import { vaultSpellingOf } from './vault-spelling.ts';

const paths = (...spelled: string[]) => spelled.map(createVaultPath);

describe('vaultSpellingOf', () => {
  it('answers the note as the vault spells it, whatever case it was asked in', () => {
    const notes = paths('Tasks/Call Sam.md', 'Other.md');
    expect(vaultSpellingOf(createVaultPath('tasks/CALL sam.md'), notes)).toBe('Tasks/Call Sam.md');
  });

  it('answers the composed spelling for a decomposed request, and the reverse', () => {
    const composed = 'Café.md'.normalize('NFC');
    const decomposed = 'Café.md'.normalize('NFD');
    expect(vaultSpellingOf(createVaultPath(decomposed), paths(composed))).toBe(composed);
    expect(vaultSpellingOf(createVaultPath(composed), paths(decomposed))).toBe(decomposed);
  });

  it('prefers the exact spelling when notes differ only in case', () => {
    const notes = paths('Call.md', 'call.md');
    expect(vaultSpellingOf(createVaultPath('call.md'), notes)).toBe('call.md');
    expect(vaultSpellingOf(createVaultPath('Call.md'), notes)).toBe('Call.md');
  });

  it('prefers the same case when notes differ only in normalization', () => {
    const notes = paths('Café.md'.normalize('NFD'), 'café.md');
    expect(vaultSpellingOf(createVaultPath('Café.md'.normalize('NFC')), notes)).toBe(
      'Café.md'.normalize('NFD'),
    );
  });

  it('answers null when two notes match only loosely, rather than pick one', () => {
    expect(vaultSpellingOf(createVaultPath('CALL.md'), paths('Call.md', 'call.md'))).toBeNull();
  });

  it('answers null when no note matches', () => {
    expect(vaultSpellingOf(createVaultPath('Call.md'), paths('Other.md'))).toBeNull();
  });
});
