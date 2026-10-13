import { describe, expect, it } from 'vitest';
import { MeetingMappingError } from './meeting-mapping-error.ts';
import { mapMeeting, type MeetingFields } from './meeting-to-atlas.ts';

/*
 * The structured seam (P28-09): a provider that hands its turns over as data
 * (Granola's API) is written from them, never rendered to text and read back,
 * and a link back to the provider's copy is kept as `source_url:`. All names
 * here are made up.
 */

const BASE: MeetingFields = {
  title: 'Renewal call',
  date: '2026-10-06',
  start: '10:00',
  source: 'granola',
  sourceId: 'not_4kTq2mWxLp4Rz7',
};

const content = (fields: MeetingFields) => mapMeeting({ ...BASE, ...fields }).content;
const transcriptOf = (fields: MeetingFields) => content(fields).split('## Transcript\n\n')[1];

const turn = (speaker: unknown, time: unknown, words: unknown, approximate?: unknown) => ({
  speaker,
  time,
  words,
  ...(approximate === undefined ? {} : { approximate }),
});

describe('a meeting handed over with structured turns', () => {
  it('writes each turn as given, in order, with ids from ^t0001', () => {
    const fields = {
      turns: [
        turn('You', '10:01:05', 'Morning.'),
        turn('Tobias Fenn', '10:01:11', 'Yes: sixty days.'),
      ],
      clock: 'wall',
    };
    expect(transcriptOf(fields)).toBe(
      [
        '**You** [10:01:05] Morning. ^t0001',
        '',
        '**Tobias Fenn** [10:01:11] Yes: sixty days. ^t0002',
        '',
      ].join('\n'),
    );
    expect(content(fields)).toContain('\ntranscript_clock: wall\n');
  });

  it('keeps a speaker named with a colon whole, which the text reader would split', () => {
    const fields = { turns: [turn('Fenn: Tobias', '10:01:05', 'Hello.')], clock: 'wall' };
    expect(transcriptOf(fields)).toBe('**Fenn: Tobias** [10:01:05] Hello. ^t0001\n');
  });

  it('takes the stars out of a speaker, so the name cannot close its bold early', () => {
    const fields = { turns: [turn('**Mara** Quill*', '10:01:05', 'Hello.')], clock: 'wall' };
    expect(transcriptOf(fields)).toBe('**Mara Quill** [10:01:05] Hello. ^t0001\n');
  });

  it('names a blank speaker Unknown and drops a turn with no words', () => {
    const fields = {
      turns: [turn('  ', '10:01:05', 'Hello.'), turn('You', '10:01:09', ' \n ')],
      clock: 'wall',
    };
    expect(transcriptOf(fields)).toBe('**Unknown** [10:01:05] Hello. ^t0001\n');
  });

  it('escapes an id-shaped word in the words, so only the turn’s own id ends it', () => {
    const fields = { turns: [turn('You', '10:01:05', 'See ^t9 later.')], clock: 'wall' };
    expect(transcriptOf(fields)).toBe('**You** [10:01:05] See \\^t9 later. ^t0001\n');
  });

  it('writes a turn with no time unstamped, and an approximate one with ~', () => {
    const fields = {
      turns: [turn('You', null, 'Hello.'), turn('Unknown', '00:09:44', 'Hi.', true)],
    };
    expect(transcriptOf(fields)).toBe(
      ['**You** Hello. ^t0001', '', '**Unknown** [~00:09:44] Hi. ^t0002', ''].join('\n'),
    );
  });

  it('counts elapsed time when no clock is given, as the contract does', () => {
    const fields = { turns: [turn('You', '00:00:05', 'Hello.')] };
    expect(content(fields)).toContain('\ntranscript_clock: elapsed\n');
  });

  it('starts a meeting with no start at the first wall-clock turn', () => {
    const fields = { start: '', turns: [turn('You', '14:58:30', 'Hi.')], clock: 'wall' };
    expect(content(fields)).toContain("\nstart: '14:58'\n");
  });

  it('reads the turns, not the transcript text, when both are given', () => {
    const fields = {
      transcript: '**[09:00:00] Tobias Fenn:** From the text.',
      turns: [turn('You', '10:01:05', 'From the turns.')],
      clock: 'wall',
    };
    expect(transcriptOf(fields)).toBe('**You** [10:01:05] From the turns. ^t0001\n');
  });

  it('reads the transcript text when the turns are an empty list', () => {
    const fields = { transcript: '**[09:00:00] Tobias Fenn:** From the text.', turns: [] };
    expect(transcriptOf(fields)).toBe('**Tobias Fenn** [09:00:00] From the text. ^t0001\n');
  });

  it.each([
    ['not a list', { turns: 'You: hello' }, /turns: expected a list/],
    ['an entry that is not a turn', { turns: ['You: hello'] }, /turns\[0\]: expected/],
    ['a clock that is neither', { turns: [turn('You', null, 'Hi.')], clock: 'utc' }, /clock/],
    [
      'a wall time past the day',
      { turns: [turn('You', '24:00:00', 'Hi.')], clock: 'wall' },
      /turns\[0\]\.time: "24:00:00" is not a time of day/,
    ],
    [
      'an elapsed time that is not one',
      { turns: [turn('You', '5 minutes', 'Hi.')] },
      /turns\[0\]\.time: "5 minutes"/,
    ],
    ['words that are a record', { turns: [turn('You', null, { a: 1 })] }, /expected text/],
  ])('refuses %s with a MeetingMappingError', (_, fields, message) => {
    expect(() => content(fields)).toThrow(MeetingMappingError);
    expect(() => content(fields)).toThrow(message);
  });
});

describe('the provider’s link, as source_url', () => {
  it('is written after external_id, quoted', () => {
    const file = content({ url: 'https://notes.granola.ai/d/0b6c1d2e' });
    expect(file).toContain(
      "\nexternal_id: 'not_4kTq2mWxLp4Rz7'\nsource_url: 'https://notes.granola.ai/d/0b6c1d2e'\n",
    );
  });

  it('is left out when none is given, so every file without one is as it was', () => {
    expect(content({})).toBe(content({ url: '' }));
    expect(content({})).not.toContain('source_url');
  });

  it.each(['javascript:alert(1)', 'notes.granola.ai/d/1', 'https://'])(
    'refuses %s, which is not a web address',
    (url) => {
      expect(() => content({ url })).toThrow(MeetingMappingError);
      expect(() => content({ url })).toThrow(/url: .* is not a web address/);
    },
  );
});
