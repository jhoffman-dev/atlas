import { describe, expect, it } from 'vitest';
import {
  fabAnchorCell,
  fabAnchorLabel,
  fabAnchorStep,
  fabDialAlign,
  fabDialDirection,
  isFabAnchor,
  FAB_ANCHORS,
} from './fab-anchor.ts';

describe('fabDialDirection', () => {
  it('opens up from the bottom row and down from the top', () => {
    expect(fabDialDirection('bottom-right')).toBe('up');
    expect(fabDialDirection('bottom-middle')).toBe('up');
    expect(fabDialDirection('bottom-left')).toBe('up');
    expect(fabDialDirection('top-left')).toBe('down');
    expect(fabDialDirection('top-middle')).toBe('down');
    expect(fabDialDirection('top-right')).toBe('down');
  });

  it('opens inward from either side', () => {
    expect(fabDialDirection('left-centre')).toBe('right');
    expect(fabDialDirection('right-centre')).toBe('left');
  });
});

describe('fabDialAlign', () => {
  it('lines the dial up with the nearer edge in a corner, and centres it elsewhere', () => {
    expect(fabDialAlign('bottom-right')).toBe('end');
    expect(fabDialAlign('top-left')).toBe('start');
    expect(fabDialAlign('bottom-middle')).toBe('center');
    expect(fabDialAlign('left-centre')).toBe('center');
  });
});

describe('fabAnchorStep', () => {
  it('moves one place in the direction asked', () => {
    expect(fabAnchorStep('bottom-right', 'left')).toBe('bottom-middle');
    expect(fabAnchorStep('bottom-right', 'up')).toBe('right-centre');
    expect(fabAnchorStep('top-left', 'right')).toBe('top-middle');
  });

  it('carries on across the centre, which is not a place', () => {
    expect(fabAnchorStep('left-centre', 'right')).toBe('right-centre');
    expect(fabAnchorStep('bottom-middle', 'up')).toBe('top-middle');
  });

  it('stays put at the edge', () => {
    expect(fabAnchorStep('bottom-right', 'right')).toBe('bottom-right');
    expect(fabAnchorStep('top-left', 'up')).toBe('top-left');
  });
});

describe('fabAnchorCell', () => {
  it('places each anchor on the three-by-three grid, leaving the centre empty', () => {
    expect(fabAnchorCell('top-left')).toEqual({ column: 0, row: 0 });
    expect(fabAnchorCell('right-centre')).toEqual({ column: 2, row: 1 });
    expect(fabAnchorCell('bottom-middle')).toEqual({ column: 1, row: 2 });
    const cells = FAB_ANCHORS.map((anchor) => fabAnchorCell(anchor));
    expect(cells).not.toContainEqual({ column: 1, row: 1 });
    expect(new Set(cells.map(({ column, row }) => `${column},${row}`)).size).toBe(8);
  });
});

describe('anchors as values', () => {
  it('recognises the eight anchors and nothing else', () => {
    expect(FAB_ANCHORS).toHaveLength(8);
    expect(FAB_ANCHORS.every(isFabAnchor)).toBe(true);
    expect(isFabAnchor('centre')).toBe(false);
    expect(isFabAnchor(3)).toBe(false);
  });

  it('reads as words', () => {
    expect(fabAnchorLabel('top-left')).toBe('top left');
    expect(fabAnchorLabel('right-centre')).toBe('right centre');
  });
});
