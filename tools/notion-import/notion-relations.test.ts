import { describe, expect, it } from 'vitest';
import { notionIdIn, notionIdOf, readOptions, readRelation } from './notion-relations.ts';

const ID = 'c3000000000000000000000000000001';

describe('a Notion page id', () => {
  it('is read from a file name, a relative link and a notion.so address alike', () => {
    expect(notionIdIn(`Mara Quill ${ID}`)).toBe(ID);
    expect(notionIdIn(`../People%20c3000000000000000000000000000000/Mara%20Quill%20${ID}.md`)).toBe(
      ID,
    );
    expect(notionIdIn(`https://www.notion.so/Mara-Quill-${ID}?pvs=21`)).toBe(ID);
  });

  it('is written without dashes and in lower case, as the vault keeps it', () => {
    expect(notionIdIn('Page A1000000-0000-4000-8000-0000000000AB')).toBe(
      'a10000000000400080000000000000ab',
    );
  });

  it('is not found in hex that runs on past 32 digits, or in text with none', () => {
    expect(notionIdIn(`x${ID}0`)).toBeNull();
    expect(notionIdIn('Mara Quill')).toBeNull();
  });

  it('as a note wrote it, is an id and nothing else', () => {
    expect(notionIdOf(` ${ID} `)).toBe(ID);
    expect(notionIdOf(`see ${ID}`)).toBeNull();
    expect(notionIdOf(3)).toBeNull();
  });
});

describe('a relation cell', () => {
  it('names each page it links, by title and id, whatever the link looks like', () => {
    const cell = `Mara Quill (https://www.notion.so/Mara-Quill-${ID}?pvs=21), Tobias Fenn (../People%20x/Tobias%20Fenn%20c3000000000000000000000000000002.md)`;
    expect(readRelation(cell)).toEqual([
      { title: 'Mara Quill', id: ID },
      { title: 'Tobias Fenn', id: 'c3000000000000000000000000000002' },
    ]);
  });

  it('keeps a comma that is part of a title', () => {
    expect(readRelation(`Larkspur Payroll, renewal (Larkspur%20${ID}.md)`)).toEqual([
      { title: 'Larkspur Payroll, renewal', id: ID },
    ]);
  });

  it('with no links, is titles separated by commas', () => {
    expect(readRelation('Pricing, Quarterly numbers , ')).toEqual([
      { title: 'Pricing', id: null },
      { title: 'Quarterly numbers', id: null },
    ]);
  });
});

describe('a multi-select cell', () => {
  it('is its options, without the spaces around them', () => {
    expect(readOptions(' payroll,  contracts ,')).toEqual(['payroll', 'contracts']);
  });
});
