import { describe, expect, it } from 'vitest';
import { COLUMN_PREVIEW, columnPreview } from './index.ts';

describe('columnPreview', () => {
  it('shows a short column whole', () => {
    expect(columnPreview({ count: 3, expanded: false })).toEqual({ shown: 3, hidden: 0 });
    expect(columnPreview({ count: 0, expanded: false })).toEqual({ shown: 0, hidden: 0 });
  });

  it('holds a long column back behind "+ N more"', () => {
    expect(columnPreview({ count: 166, expanded: false })).toEqual({
      shown: COLUMN_PREVIEW,
      hidden: 166 - COLUMN_PREVIEW,
    });
  });

  it('never hides a single card, which would cost as much room as showing it', () => {
    const justOver = COLUMN_PREVIEW + 1;
    expect(columnPreview({ count: justOver, expanded: false })).toEqual({
      shown: justOver,
      hidden: 0,
    });
    expect(columnPreview({ count: justOver + 1, expanded: false }).hidden).toBe(2);
  });

  it('shows everything once opened', () => {
    expect(columnPreview({ count: 166, expanded: true })).toEqual({ shown: 166, hidden: 0 });
  });

  it('takes another limit, and makes sense of a nonsense count', () => {
    expect(columnPreview({ count: 10, expanded: false, limit: 2 })).toEqual({
      shown: 2,
      hidden: 8,
    });
    expect(columnPreview({ count: -3, expanded: false })).toEqual({ shown: 0, hidden: 0 });
  });
});
