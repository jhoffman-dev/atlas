import { describe, expect, it } from 'vitest';
import { openHowFrom } from './open-how.ts';

const click = (keys: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>) => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...keys,
});

describe('openHowFrom', () => {
  it('opens here on a plain click', () => {
    expect(openHowFrom(click({}))).toBe('here');
  });

  it('opens a new tab on ⌘-click, or Ctrl-click off a Mac', () => {
    expect(openHowFrom(click({ metaKey: true }))).toBe('new-tab');
    expect(openHowFrom(click({ ctrlKey: true }))).toBe('new-tab');
  });

  it('splits on ⌘⇧-click', () => {
    expect(openHowFrom(click({ metaKey: true, shiftKey: true }))).toBe('split');
  });

  it('ignores Shift on its own, which selects text', () => {
    expect(openHowFrom(click({ shiftKey: true }))).toBe('here');
  });
});
