import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEAST_WORK_WIDTH, SIDEBAR_WIDTH, collapseFor } from './collapse.ts';

const styles = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'desktop',
  'src',
  'styles',
);
const read = (file: string) => readFileSync(join(styles, file), 'utf8');

describe('collapseFor at every boundary (attack #353)', () => {
  it.each([
    [1020, true, false],
    [1019, true, true],
    [1020, false, false],
    [1019, false, false],
    [796, false, false],
    [795, false, true],
    [796, true, true],
    [795, true, true],
    [720, true, true],
    [720, false, true],
  ] as const)(
    'at %ipx with the sidebar open=%s, collapses the aside: %s',
    (width, sidebarOpen, aside) => {
      expect(collapseFor({ width, sidebarOpen })).toEqual({ aside });
    },
  );

  it('answers only for the aside: there is no left-sidebar fold to read', () => {
    expect(Object.keys(collapseFor({ width: 0, sidebarOpen: true }))).toEqual(['aside']);
  });
});

/**
 * Every width the slot can take (aside.css: 300px, and 340px for the type
 * editor's `.aside--type`), held against the narrowest window shell.css still
 * shows the aside in: the work beside it must keep its least width.
 */
describe('shell.css keeps the work at its least width beside every aside (attack #353)', () => {
  const shell = read('shell.css');
  const aside = read('aside.css');
  const slotWidths = [...aside.matchAll(/--aside-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
  const breakpoints = [...shell.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) =>
    Number(m[1]),
  );

  it('reads both slot widths and both breakpoints', () => {
    expect(slotWidths).toEqual([300, 340]);
    expect(breakpoints).toHaveLength(2);
  });

  it.each([300, 340])(
    'a %ipx aside never squeezes the work under its least, sidebar open',
    (slot) => {
      // The narrowest window that still draws the aside with the left sidebar open.
      const narrowest = Math.max(...breakpoints) + 1;
      expect(narrowest - SIDEBAR_WIDTH - slot).toBeGreaterThanOrEqual(LEAST_WORK_WIDTH);
    },
  );

  it.each([300, 340])(
    'a %ipx aside never squeezes the work under its least, sidebar hidden',
    (slot) => {
      const narrowest = Math.min(...breakpoints) + 1;
      expect(narrowest - slot).toBeGreaterThanOrEqual(LEAST_WORK_WIDTH);
    },
  );
});

// Known from review: the collapse queries hide today's chat slot too. Pinned here.
describe('shell.css collapse spares the chat until 8b moves it (attack #353)', () => {
  it('scopes the collapse to a slot holding the right sidebar', () => {
    const shell = read('shell.css');
    const queries = [...shell.matchAll(/@media \(max-width: \d+px\)\s*\{([^}]*)\{/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(queries).toHaveLength(2);
    for (const selector of queries) expect(selector).toMatch(/:has\(> \.aside\)/);
  });
});
