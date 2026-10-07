import { describe, expect, it } from 'vitest';
import { objectTypeIcon, TYPE_ICONS } from './type-icon.ts';

describe('objectTypeIcon', () => {
  it('draws a type with the icon it chose', () => {
    expect(objectTypeIcon({ name: 'book', icon: 'grid' })).toBe('grid');
  });

  it('guesses from the name when it chose none', () => {
    expect(objectTypeIcon({ name: 'task' })).toBe('task');
    expect(objectTypeIcon({ name: 'project' })).toBe('board');
    expect(objectTypeIcon({ name: 'book' })).toBe('doc');
  });

  it('never offers the system folder’s gear as a type’s icon', () => {
    expect(TYPE_ICONS).not.toContain('system');
    expect(TYPE_ICONS).toContain('doc');
  });
});
