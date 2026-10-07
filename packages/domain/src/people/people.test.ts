import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import {
  isPersonType,
  personChipFor,
  personChipLookup,
  personInitial,
  rankMentionSuggestions,
  type KnownPerson,
  type MentionSuggestion,
} from './index.ts';

const path = (value: string) => createVaultPath(value);
const person = (value: string, modified = 0): KnownPerson => ({ path: path(value), modified });

const julie = person('People/Julie Brandt-Hoffer.md', 100);
const jules = person('Jules Verne.md', 300);
const anna = person('Anna Julian.md', 200);
const bob = person('Bob.md', 50);
const archived = person('Archive/People/Julia Old.md', 999);
const people = [julie, jules, anna, bob, archived];
const linkable = people.map((known) => known.path);

const names = (suggestions: readonly MentionSuggestion[]) =>
  suggestions.map((item) => (item.kind === 'person' ? item.name : `+${item.name}`));

const rank = (query: string, options: { people?: readonly KnownPerson[]; limit?: number } = {}) =>
  rankMentionSuggestions(query, { people, linkable, ...options });

describe('people offered after @', () => {
  it('offers everyone not archived, the most recently changed first, before a letter is typed', () => {
    expect(names(rank(''))).toEqual(['Jules Verne', 'Anna Julian', 'Julie Brandt-Hoffer', 'Bob']);
  });

  it('puts a name that starts with what was typed before one with a word that does', () => {
    // Jules and Julie start with it; Anna Julian only has a word that does.
    expect(names(rank('jul'))).toEqual([
      'Jules Verne',
      'Julie Brandt-Hoffer',
      'Anna Julian',
      '+jul',
    ]);
  });

  it('puts a word that starts with it before a name that merely contains it, however recent', () => {
    const clover = person('Clover.md', 1_000);
    expect(names(rank('ver', { people: [clover, jules] }))).toEqual([
      'Jules Verne',
      'Clover',
      '+ver',
    ]);
  });

  it('finds a person by a later word, a hyphenated part, or anywhere in the name', () => {
    expect(names(rank('hoff'))).toEqual(['Julie Brandt-Hoffer', '+hoff']);
    expect(names(rank('ulia'))).toEqual(['Anna Julian', '+ulia']);
  });

  it('puts the person whose name is exactly what was typed first, and offers no new one', () => {
    const expected: MentionSuggestion[] = [
      { kind: 'person', path: path('Bob.md'), name: 'Bob', target: 'Bob' },
    ];
    expect(rank('Bob')).toEqual(expected);
  });

  it('breaks ties on recency by name, so the list never reshuffles for no reason', () => {
    const twins = [person('Zed Alpha.md', 5), person('Zed Beta.md', 5)];
    expect(names(rank('zed', { people: twins }))).toEqual(['Zed Alpha', 'Zed Beta', '+zed']);
  });

  it('never offers an archived person', () => {
    expect(names(rank('julia'))).toEqual(['Anna Julian', '+julia']);
  });

  it('writes the name when it opens the person, and the path when it is shared', () => {
    const shared = [person('People/Sam.md'), person('Clients/Sam.md')];
    const ranked = rankMentionSuggestions('sam', {
      people: shared,
      linkable: [...shared.map((known) => known.path), path('Sam.md')],
    });
    expect(ranked.filter((item) => item.kind === 'person').map((item) => item.target)).toEqual([
      'Clients/Sam',
      'People/Sam',
    ]);
  });

  it('keeps to the limit, and still offers the new person after it', () => {
    expect(names(rank('', { limit: 2 }))).toEqual(['Jules Verne', 'Anna Julian']);
    expect(names(rank('j', { limit: 1 }))).toEqual(['Jules Verne', '+j']);
  });
});

describe('a new person after @', () => {
  it('is offered last, as typed, when nobody has that name', () => {
    expect(rank('Julie Brandt').at(-1)).toEqual({ kind: 'create', name: 'Julie Brandt' });
  });

  it('is not offered for a name someone already has, whatever its case', () => {
    expect(names(rank('jules verne'))).toEqual(['Jules Verne']);
  });

  it('is not offered once a space closes the name, so Enter makes a new line', () => {
    expect(names(rank('Carol '))).toEqual([]);
    expect(names(rank('jules '))).toEqual(['Jules Verne']);
  });

  it('is offered for a name of up to three words, never for a sentence', () => {
    expect(rank('Ann Marie Lee').at(-1)).toEqual({ kind: 'create', name: 'Ann Marie Lee' });
    expect(names(rank('Bob said we'))).toEqual(['+Bob said we']);
    expect(names(rank('Bob said we should'))).toEqual([]);
  });

  it('is not offered for a name a link could not hold', () => {
    for (const query of ['C# Guild', 'Up^Down']) {
      expect(rank(query).some((item) => item.kind === 'create')).toBe(false);
    }
  });

  it('is offered for a name with initials, which keeps its dots', () => {
    expect(rank('J.R. Hartley').at(-1)).toEqual({ kind: 'create', name: 'J.R. Hartley' });
  });

  it('is cleaned of what no file name can hold', () => {
    expect(rank('Ann/Lee').at(-1)).toEqual({ kind: 'create', name: 'Ann Lee' });
  });
});

describe('what is not a name after @', () => {
  it('is an @ followed by a space', () => {
    expect(rank(' Bob')).toEqual([]);
  });

  it('is a sentence carrying on past a few words', () => {
    expect(names(rank('Julie Brandt Hoffer is'))).toEqual([]);
    expect(names(rank('Julie Brandt-Hoffer'))).toEqual(['Julie Brandt-Hoffer']);
    expect(rank('Julie said we should go')).toEqual([]);
  });

  it('is anything reaching punctuation', () => {
    for (const query of ['Bob,', 'Bob.', 'Bob?', 'example.com', 'Bob)']) {
      expect(rank(query)).toEqual([]);
    }
  });
});

describe('a person chip', () => {
  const notes: VaultPath[] = [path('People/Julie.md'), path('Julie.md'), path('Plan.md')];
  const known = new Set<string>(['People/Julie.md']);

  it('is drawn for a link that opens a person', () => {
    expect(personChipFor('People/Julie', { people: known, notes })).toEqual({
      name: 'Julie',
      initial: 'J',
    });
  });

  it('is not drawn for a link that opens another note of the same name, or nothing', () => {
    // `Julie` alone opens the shallower Julie.md, which is not a person.
    expect(personChipFor('Julie', { people: known, notes })).toBeNull();
    expect(personChipFor('Plan', { people: known, notes })).toBeNull();
    expect(personChipFor('Nobody', { people: known, notes })).toBeNull();
  });
});

describe('a person chip lookup', () => {
  const notes: VaultPath[] = [path('People/Julie.md'), path('Julie.md'), path('Plan.md')];
  const people = new Set<string>(['People/Julie.md']);

  it('draws the chips personChipFor draws', () => {
    const chipFor = personChipLookup({ people, notes });
    for (const target of ['People/Julie', 'Julie', 'Plan', 'Nobody', 'people/julie']) {
      expect(chipFor(target), target).toEqual(personChipFor(target, { people, notes }));
    }
  });

  it('answers a target it has seen from what it found the first time', () => {
    const chipFor = personChipLookup({ people, notes });
    expect(chipFor('People/Julie')).toBe(chipFor('People/Julie'));
  });
});

describe('a person', () => {
  // Exactly as the index matches `type:` for @, so a page says "Mentioned in"
  // for just the notes @ offers (A21-02).
  it('is a note of the person type, spelled as the index matches it', () => {
    expect(isPersonType('person')).toBe(true);
    expect(isPersonType('Person')).toBe(false);
    expect(isPersonType(' person')).toBe(false);
    expect(isPersonType('company')).toBe(false);
    expect(isPersonType(null)).toBe(false);
  });

  it('shows the first letter of their name, or ? when it has none', () => {
    expect(personInitial('julie')).toBe('J');
    expect(personInitial('  émile')).toBe('É');
    expect(personInitial('(2) Pat')).toBe('2');
    expect(personInitial('—')).toBe('?');
  });
});

describe('the Person template is never offered after @ (issue #15)', () => {
  it('leaves out a note in .atlas that declares type: person', () => {
    const template = person('.atlas/templates/Person.md', 9_999);
    const ranked = rank('person', { people: [...people, template] });
    expect(ranked.some((item) => item.kind === 'person')).toBe(false);
    expect(names(rank('ju', { people: [...people, template] }))).toContain('Julie Brandt-Hoffer');
  });
});
