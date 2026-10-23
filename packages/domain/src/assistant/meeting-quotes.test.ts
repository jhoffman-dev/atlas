import { describe, expect, it } from 'vitest';
import { meetingTurnsOf } from '../meetings/meeting-turns.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { linkingAmong } from './citation.ts';
import {
  aboutWords,
  ANY_TURN,
  meetingQuotes,
  QUOTE_CHARACTERS,
  QUOTES_PER_MEETING,
  turnWanted,
  type TurnFilter,
} from './meeting-quotes.ts';

const PATH = createVaultPath('Meetings/Kickoff.md');
const { targetOf } = linkingAmong([PATH]);

const meeting = (turns: readonly string[]): string =>
  [
    '---',
    'type: meeting',
    '---',
    '',
    '## Summary',
    '',
    'The cut-over.',
    '',
    '## Transcript',
    '',
    ...turns.flatMap((turn) => [turn, '']),
  ].join('\n');

const TEXT = meeting([
  '**Mara Quill** [00:00:05] Shall we start with the cut-over plan? ^t0001',
  '**Tobias Fenn** [00:00:20] The cutover needs a rollback note first. ^t0002',
  '**You** [00:01:00] I can write the rollback note. ^t0003',
  '**Remote Speaker 2** [00:01:30] What about the café payroll run? ^t0004',
  '**Mara Quill** Agreed, the rollback comes first.',
]);

const turns = meetingTurnsOf(TEXT);
const filter = (wanted: Partial<TurnFilter>): TurnFilter => ({ ...ANY_TURN, ...wanted });
const quotes = (wanted: Partial<TurnFilter>) =>
  meetingQuotes({ path: PATH, turns, filter: filter(wanted), targetOf });

describe('aboutWords', () => {
  it('folds case and accents and splits on punctuation, each word once', () => {
    expect(aboutWords('Café  cut-over, CUT')).toEqual(['cafe', 'cut', 'over']);
  });

  it('holds nothing for punctuation alone', () => {
    expect(aboutWords(' "" -- ?')).toBeNull();
  });
});

describe('meetingQuotes', () => {
  it('quotes a person’s own turns, by any spelling of their name, in the order spoken', () => {
    const found = quotes({ speakers: ['mara quill'] });
    expect(found.quotes.map((quote) => quote.quote)).toEqual([
      'Shall we start with the cut-over plan?',
      'Agreed, the rollback comes first.',
    ]);
    expect(found.quotes[0]).toEqual({
      speaker: 'Mara Quill',
      time: '00:00:05',
      quote: 'Shall we start with the cut-over plan?',
      cut: false,
      cite: { link: '[[Kickoff#^t0001]]', kind: 'block', path: 'Meetings/Kickoff.md' },
    });
  });

  it('cites a turn the file left without an id by the Transcript heading, and gives no time', () => {
    const [last] = quotes({ speakers: ['Mara Quill'], words: ['agreed'] }).quotes;
    expect(last?.cite).toEqual({
      link: '[[Kickoff#Transcript]]',
      kind: 'heading',
      path: 'Meetings/Kickoff.md',
    });
    expect(last?.time).toBeNull();
  });

  it('keeps the turns holding every word asked, each word starting a word of the turn', () => {
    expect(quotes({ words: ['rollback', 'note'] }).quotes.map((q) => q.cite.link)).toEqual([
      '[[Kickoff#^t0002]]',
      '[[Kickoff#^t0003]]',
    ]);
    // "cut" starts "cut-over" and "cutover"; "over" must start a word of the same turn.
    expect(quotes({ words: ['cut', 'over'] }).quotes.map((q) => q.cite.link)).toEqual([
      '[[Kickoff#^t0001]]',
    ]);
    expect(quotes({ words: ['cafe'] }).quotes.map((q) => q.cite.link)).toEqual([
      '[[Kickoff#^t0004]]',
    ]);
    expect(quotes({ words: ['ollback'] }).quotes).toEqual([]);
    expect(quotes({ words: ['roll'] }).quotes.map((q) => q.cite.link)).toEqual([
      '[[Kickoff#^t0002]]',
      '[[Kickoff#^t0003]]',
      '[[Kickoff#Transcript]]',
    ]);
  });

  it('asks both of a turn: said by the person, and about the words', () => {
    expect(quotes({ speakers: ['Tobias Fenn'], words: ['rollback'] }).matched).toBe(1);
    expect(quotes({ speakers: ['Mara Quill'], words: ['payroll'] }).matched).toBe(0);
  });

  it('never takes the owner’s or an unnamed speaker’s turn for a person’s', () => {
    expect(quotes({ speakers: ['You', 'Remote Speaker 2'] }).quotes).toEqual([]);
  });

  it('keeps only the blocks a finder named, and none without an id', () => {
    const found = quotes({ blocks: new Set(['t0003', 'missing']) });
    expect(found.quotes.map((quote) => quote.speaker)).toEqual(['You']);
    expect(quotes({ blocks: new Set<string>() }).quotes).toEqual([]);
  });

  it('caps a meeting’s quotes and says how many turns were wanted', () => {
    const many = meetingTurnsOf(
      meeting(Array.from({ length: 9 }, (_, at) => `**Mara Quill** Point ${at}. ^t${at + 10}`)),
    );
    const found = meetingQuotes({
      path: PATH,
      turns: many,
      filter: filter({ speakers: ['Mara Quill'] }),
      targetOf,
    });
    expect(found.quotes).toHaveLength(QUOTES_PER_MEETING);
    expect(found.matched).toBe(9);
  });

  it('cuts a long turn at the cap and says so', () => {
    const long = 'word '.repeat(200).trim();
    const [quote] = meetingQuotes({
      path: PATH,
      turns: meetingTurnsOf(meeting([`**Mara Quill** ${long} ^t0001`])),
      filter: ANY_TURN,
      targetOf,
    }).quotes;
    expect(quote?.cut).toBe(true);
    expect(quote?.quote.length).toBeLessThanOrEqual(QUOTE_CHARACTERS);
    expect(quote?.quote.endsWith('…')).toBe(true);
  });

  it('wants every turn when nothing is asked', () => {
    expect(turns.every((turn) => turnWanted(turn, ANY_TURN))).toBe(true);
  });
});

describe('the vault owner’s own turns', () => {
  it('counts "You" among a person’s turns only when the person is the vault owner', () => {
    const mara = filter({ speakers: ['Mara Quill'] });
    const asOthers = quotes(mara).quotes.map((quote) => quote.speaker);
    expect(asOthers).toEqual(['Mara Quill', 'Mara Quill']);
    const asOwner = quotes({ ...mara, includesSelf: true }).quotes.map((quote) => quote.speaker);
    expect(asOwner).toEqual(['Mara Quill', 'You', 'Mara Quill']);
  });
});
