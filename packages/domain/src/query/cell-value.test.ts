import { describe, expect, it } from 'vitest';
import { cellShownValue, cellWriteValue, sameCellValue } from './cell-value.ts';

describe('cellWriteValue', () => {
  it('writes an emptied cell as no value, whatever its editor', () => {
    expect(cellWriteValue('')).toBeNull();
    expect(cellWriteValue([])).toBeNull();
    expect(cellWriteValue(null)).toBeNull();
  });

  it('writes what the editor typed or picked, typed as it was', () => {
    expect(cellWriteValue('Doing')).toBe('Doing');
    expect(cellWriteValue(3)).toBe(3);
    expect(cellWriteValue(0)).toBe(0);
    expect(cellWriteValue(false)).toBe(false);
    expect(cellWriteValue('2026-10-19')).toBe('2026-10-19');
    expect(cellWriteValue(['[[Larkspur Payroll]]'])).toEqual(['[[Larkspur Payroll]]']);
  });
});

describe('cellShownValue', () => {
  it('draws a value as the view reads it back: text trimmed, a number as a number', () => {
    expect(cellShownValue(' Doing ')).toBe('Doing');
    expect(cellShownValue(412)).toBe(412);
    expect(cellShownValue(true)).toBe('true');
  });

  it('draws several links as one comma-separated cell, as the view does', () => {
    expect(cellShownValue(['[[Mara Quill]]', '[[Tobias Fenn]]'])).toBe(
      '[[Mara Quill]], [[Tobias Fenn]]',
    );
  });

  it('draws nothing for an emptied cell', () => {
    expect(cellShownValue('')).toBeNull();
    expect(cellShownValue([])).toBeNull();
    expect(cellShownValue(null)).toBeNull();
  });
});

describe('sameCellValue', () => {
  it('holds for the same value drawn twice', () => {
    expect(sameCellValue('Doing', 'Doing')).toBe(true);
    expect(sameCellValue(3, 3)).toBe(true);
  });

  it('counts a cell with nothing in it the same however the read spells nothing', () => {
    expect(sameCellValue(null, undefined)).toBe(true);
    expect(sameCellValue('', null)).toBe(true);
  });

  it('tells a changed cell apart', () => {
    expect(sameCellValue('Doing', 'Done')).toBe(false);
    expect(sameCellValue(3, 4)).toBe(false);
    expect(sameCellValue(null, 'Done')).toBe(false);
  });
});
