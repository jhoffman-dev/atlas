import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { vocabulary } from '../terms/vocabulary.ts';
import { correctMeetingBody } from './meeting-corrections.ts';

/** Tobias Fenn goes by "Toby"; "Tobi" is a product transcripts mishear as "Toby". */
const VOCABULARY = vocabulary({
  terms: [
    {
      path: createVaultPath('Terms/Tobi.md'),
      canonical: 'Tobi',
      variants: ['Toby'],
      kind: 'product',
    },
  ],
  people: [
    { path: createVaultPath('People/Tobias Fenn.md'), name: 'Tobias Fenn', aliases: ['Toby'] },
  ],
  companies: [],
});

const body = (...turns: string[]) => ['', '## Transcript', '', ...turns, ''].join('\n');

describe('correcting a transcript whose speaker label is a person’s alias', () => {
  it('leaves the label as it was heard, and still corrects the same spelling in the words', () => {
    const heard = body('**Toby** [~00:00:00] We ship Toby on Friday. ^t0001');

    const corrected = correctMeetingBody(heard, VOCABULARY);

    expect(corrected.body).toBe(body('**Toby** [~00:00:00] We ship Tobi on Friday. ^t0001'));
    expect(corrected.count).toBe(1);
  });

  it('compares the label as spellings are compared: case and spacing aside', () => {
    const lower = vocabulary({
      terms: [
        {
          path: createVaultPath('Terms/Tobi.md'),
          canonical: 'Tobi',
          variants: ['toby'],
          kind: 'product',
        },
      ],
      people: [
        { path: createVaultPath('People/Tobias Fenn.md'), name: 'Tobias Fenn', aliases: ['Toby'] },
      ],
      companies: [],
    });
    const heard = body('**toby** [~00:00:00] Morning. ^t0001');

    expect(correctMeetingBody(heard, lower).body).toBe(heard);
  });

  it('still corrects a label nobody goes by, and one that only starts with an alias', () => {
    const heard = body(
      '**Toby Two** [~00:00:00] Morning. ^t0001',
      '',
      '**Tobias Fen** [~00:00:05] Morning. ^t0002',
    );
    const withFenn = vocabulary({
      terms: [
        {
          path: createVaultPath('Terms/Tobi.md'),
          canonical: 'Tobi',
          variants: ['Toby'],
          kind: 'product',
        },
        {
          path: createVaultPath('Terms/Tobias Fenn.md'),
          canonical: 'Tobias Fenn',
          variants: ['Tobias Fen'],
          kind: 'person',
        },
      ],
      people: [{ path: createVaultPath('People/T.md'), name: 'T', aliases: ['Toby'] }],
      companies: [],
    });

    expect(correctMeetingBody(heard, withFenn).body).toBe(
      body(
        '**Tobi Two** [~00:00:00] Morning. ^t0001',
        '',
        '**Tobias Fenn** [~00:00:05] Morning. ^t0002',
      ),
    );
  });
});
