import { describe, expect, it } from 'vitest';
import { mayAutoSyncKindle } from './kindle-backoff.ts';
import { readKindleAnnotations } from './kindle-annotations.ts';
import type { KindleRawPage } from './kindle-types.ts';

/*
 * Verification of PR #511 after its fix round: the notebook reader and back-off against inputs
 * the fixes were not tested with. The books are invented; the quotes are public domain.
 */

const page = (html: string): KindleRawPage => ({ status: 200, html, redirectedTo: null });
const annotations = (rows: string) => `<div id="kp-notebook-annotations">${rows}</div>`;
const openRow = (id: string) => `<div id="${id}" class="a-row a-spacing-base">`;

function timed(read: () => void): number {
  const started = performance.now();
  read();
  return performance.now() - started;
}

// As in kindle-notebook.hostile-pages.test.ts: a linear pass over these pages takes a few ms.
const LINEAR_BUDGET_MS = 250;

describe('the notebook reader, verified after the fix round', () => {
  it('reads a passage once when one annotation row sits inside another', () => {
    const html = annotations(
      `${openRow('IDOUTERROW01')}${openRow('IDINNERROW01')}<span id="highlight">Call me Ishmael.</span></div></div>`,
    );
    const reading = readKindleAnnotations(page(html), 'B0EXAMPLE1');
    if (reading.kind !== 'annotations') {
      expect(reading.kind).toBe('unrecognised');
      return;
    }
    expect(reading.highlights.map((highlight) => highlight.quote)).toEqual(['Call me Ishmael.']);
  });

  it('reads a page of nested annotation rows in time linear in its size', () => {
    // 250 nested rows (under the depth cap) over 40 000 plain elements: about 300 KB. Each row
    // searches the whole subtree under it; an 8 MB page of this shape takes tens of seconds.
    const rows = Array.from({ length: 250 }, (_, at) =>
      openRow(`IDNESTED${String(at).padStart(4, '0')}`),
    ).join('');
    const html = annotations(`${rows}${'<i></i>'.repeat(40_000)}<span id="highlight">q</span>`);
    expect(timed(() => readKindleAnnotations(page(html), 'B0EXAMPLE1'))).toBeLessThan(
      LINEAR_BUDGET_MS,
    );
  });
});

describe('the robot-check back-off, verified after the fix round', () => {
  it('does not hold automatic syncs for ever when the stored robot-check time is not a number', () => {
    // A time read back badly from storage (Number(undefined)) is no reason to stop for good.
    expect(
      mayAutoSyncKindle({ now: Date.UTC(2026, 9, 21, 9, 0), lastRobotCheckAt: Number.NaN }),
    ).toBe(true);
  });
});
