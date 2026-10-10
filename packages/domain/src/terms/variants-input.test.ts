import { describe, expect, it } from 'vitest';
import { variantsAsInput, variantsFromInput } from './variants-input.ts';

describe('a term’s variants as one line of text', () => {
  it('are written with commas between, and plain ones read back as they were', () => {
    expect(variantsAsInput(['lark spur', 'Larks Burr'])).toBe('lark spur, Larks Burr');
    expect(variantsFromInput('lark spur, Larks Burr')).toEqual(['lark spur', 'Larks Burr']);
  });

  it('quote a variant holding a comma or a quote, a quote inside doubled', () => {
    expect(variantsAsInput(['Quill, Mara', 'the "QD"', 'Mara Quil'])).toBe(
      '"Quill, Mara", "the ""QD""", Mara Quil',
    );
  });

  it('read back exactly the variants they were written from, commas and quotes and all', () => {
    const lists = [
      ['Quill, Mara', 'Mara Quil'],
      ['a, b, c'],
      ['the "QD"', '"', ',', 'x,"y"'],
      ['Fenn Ledger'],
      [],
    ];
    for (const variants of lists) {
      expect(variantsFromInput(variantsAsInput(variants))).toEqual(variants);
    }
  });

  it('take a variant added after a quoted one as one more, the quoted one whole', () => {
    expect(variantsFromInput('"Quill, Mara", Mara Quil, Marra Quill')).toEqual([
      'Quill, Mara',
      'Mara Quil',
      'Marra Quill',
    ]);
  });

  it('read a quote that is never closed to the end of the line', () => {
    expect(variantsFromInput('lark spur, "Quill, Mara')).toEqual(['lark spur', 'Quill, Mara']);
  });

  it('keep what is typed after a closing quote, up to the comma', () => {
    expect(variantsFromInput('"Quill, M" ara, x')).toEqual(['Quill, M ara', 'x']);
  });

  it('read a quote that does not open a variant as part of it', () => {
    expect(variantsFromInput('the "QD", x')).toEqual(['the "QD"', 'x']);
  });

  it('drop blanks, and keep a repeat in any case once, as first typed', () => {
    expect(variantsFromInput(' lark spur ,Larks  Burr,, ,"",LARK SPUR')).toEqual([
      'lark spur',
      'Larks Burr',
    ]);
    expect(variantsFromInput('')).toEqual([]);
  });
});
