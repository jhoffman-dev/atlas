import { describe, expect, it } from 'vitest';
import {
  assistantPageRefusal,
  assistantPageTypes,
  namesOf,
  speaksInMeetings,
} from './assistant-pages.ts';

describe('which notes the assistant answers about', () => {
  it('briefs any linked page with a page of its own, in any spelling of its type', () => {
    for (const type of ['person', 'Company', ' project ', 'area', 'Meeting']) {
      expect(assistantPageRefusal('brief', type)).toBeNull();
    }
  });

  it('lists open loops and meetings for a person, company, project or area, not for a meeting', () => {
    expect(assistantPageTypes('open-loops')).toEqual(['person', 'company', 'project', 'area']);
    expect(assistantPageRefusal('meetings', 'meeting')).toBe(
      'entity must be a Person, Company, Project or Area note; this is a meeting note',
    );
  });

  it('says why it refuses a note of another type, or of none', () => {
    expect(assistantPageRefusal('brief', 'task')).toBe(
      'entity must be a Person, Company, Project, Area or Meeting note; this is a task note',
    );
    expect(assistantPageRefusal('open-loops', null)).toBe(
      'entity must be a Person, Company, Project or Area note; this is a note with no type',
    );
  });

  it('hears only a person speak in a transcript', () => {
    expect(speaksInMeetings('Person')).toBe(true);
    expect(speaksInMeetings('company')).toBe(false);
  });
});

describe('namesOf', () => {
  it('is the title and each alias, trimmed, blanks and repeats left out', () => {
    expect(
      namesOf('Mara Quill', { aliases: [' MQ ', '', 'Mara Quill', 3, 'Quill, Mara'] }),
    ).toEqual(['Mara Quill', 'MQ', 'Quill, Mara']);
    expect(namesOf('Tobias Fenn', { aliases: 'Toby' })).toEqual(['Tobias Fenn', 'Toby']);
    expect(namesOf('Tobias Fenn', {})).toEqual(['Tobias Fenn']);
  });
});
