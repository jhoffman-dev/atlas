import { describe, expect, it } from 'vitest';
import { answerInline } from './answer-inline.ts';

/**
 * A web link's label is the model's words, drawn beside the one part the
 * person can trust: the host. Nothing in the label may reorder it (#557).
 */
describe('a web link label', () => {
  it.each([
    ['an override', '‮'],
    ['an embedding', '‫'],
    ['an isolate', '⁧'],
    ['a mark', '‏'],
    ['the Arabic letter mark', '؜'],
  ])('loses %s, and still names its host', (_, control) => {
    expect(answerInline(`[Larkspur billing${control}](https://pay.example.com/x)`)).toEqual([
      {
        kind: 'web',
        url: 'https://pay.example.com/x',
        label: 'Larkspur billing',
        host: 'pay.example.com',
      },
    ]);
  });

  it('that is only controls is drawn as its address', () => {
    expect(answerInline('[‮⁦](https://pay.example.com/x)')).toEqual([
      {
        kind: 'web',
        url: 'https://pay.example.com/x',
        label: 'https://pay.example.com/x',
        host: null,
      },
    ]);
  });

  it('naming its host once its controls are gone shows the host once', () => {
    expect(answerInline('[pay.example.com‮](https://pay.example.com/x)')).toEqual([
      { kind: 'web', url: 'https://pay.example.com/x', label: 'pay.example.com', host: null },
    ]);
  });

  it('keeps a citation clear of the Arabic letter mark too', () => {
    expect(answerInline('[[Kickoff؜]]')).toMatchObject([{ kind: 'cite', label: 'Kickoff' }]);
  });
});
