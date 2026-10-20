import { describe, expect, it } from 'vitest';
import { previewPlacement } from './preview-placement.ts';

const viewport = { width: 1440, height: 900 };

describe('previewPlacement', () => {
  it('puts the card under the link, left edges aligned', () => {
    expect(previewPlacement({ left: 150, top: 270, bottom: 290 }, viewport)).toEqual({
      left: 150,
      top: 296,
    });
  });

  it('puts the card over the link when there is no room under it', () => {
    expect(previewPlacement({ left: 150, top: 800, bottom: 820 }, viewport)).toEqual({
      left: 150,
      bottom: 106,
    });
  });

  it('keeps the card inside the window at the right edge', () => {
    expect(previewPlacement({ left: 1300, top: 100, bottom: 120 }, viewport)).toMatchObject({
      left: 1440 - 360 - 8,
    });
  });

  it('keeps the card inside the window at the left edge', () => {
    expect(previewPlacement({ left: -40, top: 100, bottom: 120 }, viewport)).toMatchObject({
      left: 8,
    });
  });
});
