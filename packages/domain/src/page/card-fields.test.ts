import { describe, expect, it } from 'vitest';
import { cardFields } from './index.ts';

describe('cardFields', () => {
  const kinds = { status: 'select', stage: 'select', phase: 'number' } as const;

  it('shows a choice as a pill and anything else as a chip, in the view’s order', () => {
    expect(cardFields({ fields: ['phase', 'stage', 'owner', 'status'], kinds })).toEqual({
      pills: ['stage', 'status'],
      chips: ['phase', 'owner'],
    });
  });

  it('leaves out what a card shows in a place of its own', () => {
    expect(cardFields({ fields: ['title', 'path', 'summary', 'owner'], kinds })).toEqual({
      pills: [],
      chips: ['owner'],
    });
  });

  it('leaves out the property a board groups by: it is the column', () => {
    expect(cardFields({ fields: ['status', 'stage', 'phase'], groupBy: 'status', kinds })).toEqual({
      pills: ['stage'],
      chips: ['phase'],
    });
  });

  it('leaves out the property a board’s lanes are by: it is the lane', () => {
    expect(
      cardFields({
        fields: ['status', 'stage', 'phase'],
        groupBy: 'status',
        laneBy: 'stage',
        kinds,
      }),
    ).toEqual({ pills: [], chips: ['phase'] });
  });

  it('treats a property of no declared kind as a chip', () => {
    expect(cardFields({ fields: ['status'] })).toEqual({ pills: [], chips: ['status'] });
  });
});
