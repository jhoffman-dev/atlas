import { describe, expect, it } from 'vitest';
import { noteNames } from '../types/relation-names.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  cardChip,
  cardChips,
  columnIcon,
  countLabel,
  isYou,
  newNoteLabel,
  noteTone,
  pluralNoun,
  propertyRole,
} from './index.ts';

describe('propertyRole', () => {
  it('reads who a thing came from, and how long it takes, from the key', () => {
    expect(propertyRole('source')).toBe('person');
    expect(propertyRole('Owner')).toBe('person');
    expect(propertyRole('estimate')).toBe('duration');
    expect(propertyRole('phase')).toBeNull();
  });
});

describe('isYou', () => {
  it('matches "you" whatever its case or spacing, and nothing else', () => {
    expect(isYou(' You ')).toBe(true);
    expect(isYou('youth')).toBe(false);
    expect(isYou(null)).toBe(false);
  });
});

describe('cardChip', () => {
  it('labels a number with its property, so a bare 14 means something', () => {
    expect(cardChip({ key: 'phase', value: 14 })).toEqual({
      key: 'phase',
      icon: 'hash',
      text: 'Phase 14',
      you: false,
    });
    expect(cardChip({ key: 'story_points', value: '3', kind: 'number' })?.text).toBe(
      'Story points 3',
    );
  });

  it('says "From you" for a source of you, drawn as the reader', () => {
    expect(cardChip({ key: 'source', value: 'you' })).toEqual({
      key: 'source',
      icon: 'person',
      text: 'From you',
      you: true,
    });
    expect(cardChip({ key: 'owner', value: 'You' })?.text).toBe('You');
  });

  it('writes any other person as words: a slug is humanised, a name is kept', () => {
    expect(cardChip({ key: 'source', value: 'bug-fixer' })).toMatchObject({
      icon: 'person',
      text: 'Bug fixer',
      you: false,
    });
    expect(cardChip({ key: 'owner', value: 'Ada Lovelace' })?.text).toBe('Ada Lovelace');
  });

  it('gives an estimate a clock, as written', () => {
    expect(cardChip({ key: 'estimate', value: '3h' })).toMatchObject({ icon: 'clock', text: '3h' });
  });

  it('reads a date as a date, whether declared or only shaped like one', () => {
    expect(cardChip({ key: 'due', value: '2026-09-22', kind: 'date' })).toMatchObject({
      icon: 'date',
      text: 'Tue, Sep 22, 2026',
    });
    expect(cardChip({ key: 'due', value: '2026-09-22' })?.icon).toBe('date');
  });

  it('names a ticked checkbox by its property, and shows nothing for an unticked one', () => {
    expect(cardChip({ key: 'urgent', value: true })).toMatchObject({ icon: 'tag', text: 'Urgent' });
    expect(cardChip({ key: 'urgent', value: false })).toBeNull();
  });

  it('shows nothing for an unticked checkbox as the index returns it, as the text "false"', () => {
    // The index keeps a boolean as its text form (`value_text`), so a board
    // card's values carry "true" / "false", never the booleans themselves.
    expect(cardChip({ key: 'urgent', value: 'false', kind: 'checkbox' })).toBeNull();
    expect(cardChip({ key: 'urgent', value: 'true', kind: 'checkbox' })).toMatchObject({
      icon: 'tag',
      text: 'Urgent',
    });
  });

  it('shows nothing for a checkbox written as 0 or left blank', () => {
    expect(cardChip({ key: 'urgent', value: '0', kind: 'checkbox' })).toBeNull();
    expect(cardChip({ key: 'urgent', value: '', kind: 'checkbox' })).toBeNull();
  });

  it('shows any other value as a plain tag', () => {
    expect(cardChip({ key: 'severity', value: 'minor' })).toMatchObject({
      icon: 'tag',
      text: 'minor',
    });
  });

  it('makes no chip for an empty value', () => {
    expect(cardChip({ key: 'phase', value: null })).toBeNull();
    expect(cardChip({ key: 'phase', value: undefined })).toBeNull();
    expect(cardChip({ key: 'source', value: '  ' })).toBeNull();
  });
});

describe('cardChip, for a relation', () => {
  const names = noteNames([
    { path: 'Atlas.md' as VaultPath, title: 'Atlas' },
    { path: 'people/Ada.md' as VaultPath, title: 'Ada Lovelace' },
  ]);

  it('names the linked notes, never the links', () => {
    expect(cardChip({ key: 'project', value: '[[Atlas]]', kind: 'relation', names })).toEqual({
      key: 'project',
      icon: 'note',
      text: 'Atlas',
      you: false,
      missing: false,
    });
    expect(cardChip({ key: 'people', value: '[[Atlas]], [[Ada]]', names })?.text).toBe(
      'Atlas, Ada Lovelace',
    );
  });

  it('reads a link held by a person key as the person it names', () => {
    expect(cardChip({ key: 'owner', value: '[[Ada]]', names })?.text).toBe('Ada Lovelace');
  });

  it('marks a chip whose every link points nowhere as missing', () => {
    expect(cardChip({ key: 'project', value: '[[Gone]]', names })).toMatchObject({
      text: 'Gone',
      missing: true,
    });
    expect(cardChip({ key: 'people', value: '[[Gone]], [[Atlas]]', names })?.missing).toBe(false);
  });

  it('shows bare names before the notes are known', () => {
    expect(cardChip({ key: 'project', value: '[[projects/Atlas]]' })).toMatchObject({
      text: 'Atlas',
      missing: false,
    });
  });
});

describe('cardChips', () => {
  it('keeps the view’s field order and skips the empty ones', () => {
    const chips = cardChips({
      fields: ['phase', 'source', 'estimate'],
      values: { phase: 15, source: null, estimate: '3h' },
    });
    expect(chips.map((chip) => chip.text)).toEqual(['Phase 15', '3h']);
  });

  it('uses the declared kind when there is one', () => {
    const chips = cardChips({
      fields: ['phase'],
      values: { phase: '16' },
      kinds: { phase: 'number' },
    });
    expect(chips[0]?.text).toBe('Phase 16');
  });
});

describe('columnIcon', () => {
  it('draws the title as a document', () => {
    expect(columnIcon({ key: 'title' })).toBe('title');
  });

  it('draws a column by its kind', () => {
    expect(columnIcon({ key: 'status', kind: 'select' })).toBe('status');
    expect(columnIcon({ key: 'phase', kind: 'number' })).toBe('number');
    expect(columnIcon({ key: 'due', kind: 'date' })).toBe('date');
  });

  it('lets a text column that names a person or a time say so', () => {
    expect(columnIcon({ key: 'source', kind: 'text' })).toBe('person');
    expect(columnIcon({ key: 'estimate', kind: 'text' })).toBe('duration');
    expect(columnIcon({ key: 'estimate' })).toBe('duration');
  });

  it('keeps a declared kind over the key when it is not text', () => {
    expect(columnIcon({ key: 'owner', kind: 'relation' })).toBe('relation');
  });

  it('draws an undeclared column as text', () => {
    expect(columnIcon({ key: 'mystery' })).toBe('text');
  });
});

describe('pluralNoun, countLabel and newNoteLabel', () => {
  it('pluralises the names types are given', () => {
    expect(pluralNoun('Task')).toBe('tasks');
    expect(pluralNoun('Company')).toBe('companies');
    expect(pluralNoun('Day')).toBe('days');
    expect(pluralNoun('Box')).toBe('boxes');
    expect(pluralNoun('Person')).toBe('people');
    expect(pluralNoun('')).toBe('notes');
  });

  it('counts in the singular for one and the plural otherwise', () => {
    expect(countLabel({ count: 177, noun: 'Task' })).toBe('177 tasks');
    expect(countLabel({ count: 1, noun: 'Task' })).toBe('1 task');
    expect(countLabel({ count: 0, noun: 'Task' })).toBe('0 tasks');
    expect(countLabel({ count: 1, noun: '' })).toBe('1 note');
  });

  it('names the command that adds one', () => {
    expect(newNoteLabel('Task')).toBe('New task');
    expect(newNoteLabel(' ')).toBe('New note');
  });
});

describe('noteTone', () => {
  it('tints a note by its status', () => {
    expect(noteTone({ status: 'doing' })).toBe('doing');
    expect(noteTone({ status: 'Done' })).toBe('done');
    expect(noteTone({ status: 'waiting' })).toBe('backlog');
  });

  it('leaves a note with no status untinted', () => {
    expect(noteTone({})).toBeNull();
    expect(noteTone({ status: ' ' })).toBeNull();
    expect(noteTone({ status: 3 })).toBeNull();
  });
});
