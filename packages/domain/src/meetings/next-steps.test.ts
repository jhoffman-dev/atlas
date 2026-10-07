import { describe, expect, it } from 'vitest';
import { parseProviderNextSteps } from './next-steps.ts';

describe('provider next steps', () => {
  it('keep the owner, the words and the confidence as the provider gave them', () => {
    const { steps, errors } = parseProviderNextSteps(
      [
        '',
        '- [Tobias Fenn] Flag the cache: before Friday.',
        '* [Lena Hart] Send the contract. (Confidence: HIGH)',
        '- Nobody owns this one. ^s1',
      ].join('\n'),
      20,
    );
    expect(errors).toEqual([]);
    expect(steps).toEqual([
      {
        owner: 'Tobias Fenn',
        text: 'Flag the cache: before Friday.',
        confidence: null,
        blockId: null,
        line: 21,
      },
      {
        owner: 'Lena Hart',
        text: 'Send the contract.',
        confidence: 'high',
        blockId: null,
        line: 22,
      },
      { owner: null, text: 'Nobody owns this one.', confidence: null, blockId: 's1', line: 23 },
    ]);
  });

  it('report a line that is not an item, a blank owner, and a step that says nothing', () => {
    const { steps, errors } = parseProviderNextSteps(
      ['Ship it, someone.', '- [ ] A checkbox.', '- [Mara Quill] (confidence: low)'].join('\n'),
      5,
    );
    expect(steps).toEqual([]);
    expect(errors.map(({ field, line }) => [field, line])).toEqual([
      ['Provider next steps', 5],
      ['Provider next steps', 6],
      ['Provider next steps', 7],
    ]);
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringMatching(/is not a `- \[Owner\] Title: description` item/),
      expect.stringMatching(/owner is blank/),
      expect.stringMatching(/says nothing/),
    ]);
  });
});
