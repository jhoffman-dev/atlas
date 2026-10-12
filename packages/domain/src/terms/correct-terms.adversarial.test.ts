/**
 * Adversarial tests for correcting misheard spellings (P28-06, issue #12).
 * Written red against the first build; each now passes. All names are made up.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { correctTerms } from './correct-terms.ts';
import { vocabulary, type NamedEntity } from './vocabulary.ts';
import type { TermNote } from './term.ts';

const term = (canonical: string, variants: readonly string[]): TermNote => ({
  path: createVaultPath(`Terms/${canonical}.md`),
  canonical,
  variants,
  kind: null,
});

const person = (name: string, aliases: readonly string[]): NamedEntity => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  aliases,
});

/** `Quill` and `Toby` are misheard spellings a term lists; the people's aliases are only for linking. */
const VOCABULARY = vocabulary({
  terms: [
    term('Larkspur Pay', ['Lark Spur Pay']),
    term('İzmir Hub', ['izmir hab', 'İzmir hab']),
    term('Mara Quill', ['Quill', 'quill']),
    term('Tobias Fenn', ['Toby', 'toby']),
  ],
  people: [person('Mara Quill', ['Quill']), person('Tobias Fenn', ['Toby'])],
  companies: [],
});

const corrected = (text: string) => correctTerms(text, VOCABULARY).text;

describe('correctTerms, a right spelling the matcher must see through a line break or emphasis', () => {
  it('never doubles a name wrapped onto the next line at a soft line break', () => {
    expect(corrected('Then Mara\nQuill said it ships.')).toBe('Then Mara\nQuill said it ships.');
  });

  it('never doubles a name whose first word is emphasised', () => {
    expect(corrected('**Mara** Quill owns it.')).toBe('**Mara** Quill owns it.');
  });

  it('never doubles a name whose last word is emphasised or struck', () => {
    expect(corrected('Mara *Quill* and Mara ~~Quill~~ agreed.')).toBe(
      'Mara *Quill* and Mara ~~Quill~~ agreed.',
    );
  });

  it('still corrects the same word where no name is whole around it', () => {
    expect(corrected('Then Quill said it ships.')).toBe('Then Mara Quill said it ships.');
  });
});

describe('correctTerms, text that is not words', () => {
  it('never corrects inside an email address', () => {
    expect(corrected('Mail toby@fennlabs.example or fenn.toby@example.com now.')).toBe(
      'Mail toby@fennlabs.example or fenn.toby@example.com now.',
    );
  });

  it('never corrects inside a bare domain', () => {
    expect(corrected('See www.quill.example for it.')).toBe('See www.quill.example for it.');
  });

  it('never corrects inside a file path', () => {
    expect(corrected('It lives in src/quill/index.ts today.')).toBe(
      'It lives in src/quill/index.ts today.',
    );
  });

  it('never corrects a word joined to another by a hyphen', () => {
    expect(corrected('A Quill-based plan, not-Quill, and Quill - the plan.')).toBe(
      'A Quill-based plan, not-Quill, and Mara Quill - the plan.',
    );
  });

  it('leaves a markdown link whole when its target holds parentheses', () => {
    expect(corrected('[Toby](https://wiki.example/Toby_(team)) wrote it.')).toBe(
      '[Toby](https://wiki.example/Toby_(team)) wrote it.',
    );
  });

  it('refuses a variant with no word in it, so a transcript time is never rewritten', () => {
    const tilde = vocabulary({ terms: [term('Nolan', ['~'])], people: [], companies: [] });

    expect(correctTerms('**Mara Quill** [~00:00:05] Morning.', tilde).text).toBe(
      '**Mara Quill** [~00:00:05] Morning.',
    );
  });
});

describe('correctTerms, case', () => {
  it('corrects a spelling with a dotted capital I only as the term writes it', () => {
    expect(corrected('İzmir hab is late; izmir hab too.')).toBe(
      'İzmir Hub is late; İzmir Hub too.',
    );
    expect(corrected('İZMIR HAB and IZMIR HAB and iZmir hab')).toBe(
      'İZMIR HAB and IZMIR HAB and iZmir hab',
    );
  });
});
