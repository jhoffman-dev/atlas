import { describe, expect, it } from 'vitest';
import { newLinkName } from './new-link-name.ts';

/** #465: the one rule for whether a "Create" may make a note of what was typed. */

const notes = ['Garden', 'Q3 plan', 'Archive note'];
const answers = (name: string) =>
  notes.some((note) => note.toLowerCase() === name.trim().toLowerCase());

describe('newLinkName', () => {
  it.each([
    ['Mara Quill', 'Mara Quill'],
    ['  Tobias Fenn  ', 'Tobias Fenn'],
    ['Larkspur: kickoff', 'Larkspur: kickoff'],
  ])('lets %j be made, named as typed', (typed, name) => {
    expect(newLinkName(typed, answers)).toEqual({ name });
  });

  it.each([
    ['', 'Type a name'],
    ['   ', 'Type a name'],
    ['Plans/Offsite', 'a link stops at /'],
    ['Offsite|the trip', 'a link stops at |'],
    ['Offsite#Day one', 'a link stops at #'],
    ['Plan ^v2', 'a link stops at ^'],
    ['Foo [x', 'a link stops at ['],
    ['Foo ]x', 'a link stops at ]'],
    ['...', 'Give the new note a name'],
    ['***', 'Give the new note a name'],
  ])('refuses %j: %s', (typed, why) => {
    const made = newLinkName(typed, answers);
    expect('refused' in made && made.refused).toContain(why);
  });

  it.each([
    ['garden', 'garden'],
    ['Garden.', 'Garden'],
    ['Q3: plan', 'Q3 plan'],
    ['archive note', 'archive note'],
  ])(
    'refuses %j, which a note already answers to, by the name its file would get: %j',
    (typed, fileName) => {
      expect(newLinkName(typed, answers)).toEqual({
        refused: `A note is already called “${fileName}”.`,
      });
    },
  );
});
