import { describe, expect, it } from 'vitest';
import { isSidebarSectionId, parseCollapsedSections, SIDEBAR_SECTIONS } from './sidebar-section.ts';

describe('SIDEBAR_SECTIONS', () => {
  it('is the five peers, in the order the brief sets', () => {
    expect(SIDEBAR_SECTIONS.map((section) => section.id)).toEqual([
      'favorites',
      'types',
      'views',
      'dashboards',
      'userSpace',
    ]);
  });

  it('names every section', () => {
    for (const section of SIDEBAR_SECTIONS) expect(section.label).not.toBe('');
  });
});

describe('isSidebarSectionId', () => {
  it('accepts a section that exists', () => {
    expect(isSidebarSectionId('views')).toBe(true);
  });

  it.each([['inbox'], [''], [null], [7], [{ id: 'views' }]])('refuses %j', (value) => {
    expect(isSidebarSectionId(value)).toBe(false);
  });
});

describe('parseCollapsedSections', () => {
  it('keeps the sections that exist', () => {
    expect(parseCollapsedSections(['types', 'views'])).toEqual(['types', 'views']);
  });

  it('drops anything it does not recognise', () => {
    expect(parseCollapsedSections(['types', 'inbox', null, 3])).toEqual(['types']);
  });

  it('lists a section once', () => {
    expect(parseCollapsedSections(['types', 'types'])).toEqual(['types']);
  });

  it.each([[null], [undefined], ['types'], [{}]])(
    'collapses nothing when what was remembered is %j',
    (remembered) => {
      expect(parseCollapsedSections(remembered)).toEqual([]);
    },
  );
});
