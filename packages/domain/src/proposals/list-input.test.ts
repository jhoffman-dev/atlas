import { describe, expect, it } from 'vitest';
import { listAsInput, listFromInput } from './list-input.ts';

describe('listAsInput and listFromInput', () => {
  it('reads back the same list, an item holding a comma or a quote included', () => {
    const items = ['[[Larkspur Payroll, Inc.]]', '[[Fenn & Co]]', 'say "hi"'];
    const shown = listAsInput(items);
    expect(shown).toBe('"[[Larkspur Payroll, Inc.]]", [[Fenn & Co]], "say ""hi"""');
    expect(listFromInput(shown)).toEqual(items);
  });

  it('trims items and drops blanks', () => {
    expect(listFromInput(' a ,, b ,')).toEqual(['a', 'b']);
    expect(listFromInput('   ')).toEqual([]);
  });

  it('runs a quote never closed to the end, and keeps what follows a closing quote', () => {
    expect(listFromInput('"a, b')).toEqual(['a, b']);
    expect(listFromInput('"a"b, c')).toEqual(['ab', 'c']);
  });
});
