import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASIDE_COLLAPSES_BELOW,
  ASIDE_COLLAPSES_BELOW_ALONE,
  SIDEBAR_WIDTH,
  WINDOW_MIN_WIDTH,
  collapseFor,
} from './collapse.ts';

describe('collapseFor', () => {
  it('keeps the aside where it fits beside the sidebar and the work', () => {
    expect(collapseFor({ width: 1440, sidebarOpen: true })).toEqual({ aside: false });
    expect(collapseFor({ width: ASIDE_COLLAPSES_BELOW, sidebarOpen: true })).toEqual({
      aside: false,
    });
  });

  it('collapses the aside one pixel under that, before anything else', () => {
    expect(collapseFor({ width: ASIDE_COLLAPSES_BELOW - 1, sidebarOpen: true })).toEqual({
      aside: true,
    });
  });

  it('keeps the aside longer when the left sidebar is already hidden by hand', () => {
    expect(collapseFor({ width: ASIDE_COLLAPSES_BELOW - 1, sidebarOpen: false })).toEqual({
      aside: false,
    });
    expect(collapseFor({ width: ASIDE_COLLAPSES_BELOW_ALONE, sidebarOpen: false })).toEqual({
      aside: false,
    });
    expect(collapseFor({ width: ASIDE_COLLAPSES_BELOW_ALONE - 1, sidebarOpen: false })).toEqual({
      aside: true,
    });
  });

  it('never folds the left sidebar: the window’s minimum is what the sidebar fits in', () => {
    // #332 holds every bar tidy at 720 with the sidebar open; the aside is
    // long gone by then, in either state of the left.
    expect(ASIDE_COLLAPSES_BELOW_ALONE).toBeGreaterThan(WINDOW_MIN_WIDTH);
    expect(ASIDE_COLLAPSES_BELOW - ASIDE_COLLAPSES_BELOW_ALONE).toBe(SIDEBAR_WIDTH);
  });
});

/**
 * The rule is drawn by shell.css, so the media queries there must break at
 * the same widths, or the function would say one thing and the window another.
 */
describe('shell.css collapse order', () => {
  const css = readFileSync(
    join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'apps',
      'desktop',
      'src',
      'styles',
      'shell.css',
    ),
    'utf8',
  );
  const breakpoints = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));

  it('breaks at the widths collapseFor names, and no others', () => {
    expect(breakpoints.sort((a, b) => b - a)).toEqual([
      ASIDE_COLLAPSES_BELOW - 1,
      ASIDE_COLLAPSES_BELOW_ALONE - 1,
    ]);
  });

  it('hides the aside alone, never the left sidebar, at any width', () => {
    const hidden = [...css.matchAll(/@media[^{]*\{([^}]*\{[^}]*\})+?\s*\}/g)].map((m) => m[0]);
    expect(hidden).toHaveLength(2);
    for (const block of hidden) {
      expect(block).toContain('.shell__aside');
      expect(block).not.toContain('.shell__sidebar');
    }
  });
});
