import { describe, expect, it } from 'vitest';
import { nestedBlockOf } from '../bookmarks/bookmark-switch.ts';
import { anchorStyleOf } from '../markdown/block-outline.ts';
import {
  codeOfQueryBlock,
  queryBlockNode,
  queryBlockOfCode,
  queryBlockText,
  readQueryBlock,
} from './query-block.ts';

const QUERY = 'FROM meeting WHERE people = this';

describe('queryBlockOfCode', () => {
  it('makes a query block of a fence whose language is atlas-query', () => {
    expect(queryBlockOfCode({ language: 'atlas-query', meta: null, text: QUERY })).toEqual(
      queryBlockNode(QUERY),
    );
  });

  it.each([
    ['another language', { language: 'sql', meta: null, text: QUERY }],
    ['no language', { language: null, meta: null, text: QUERY }],
    ['words after the language', { language: 'atlas-query', meta: 'wide', text: QUERY }],
    ['the language in capitals', { language: 'ATLAS-QUERY', meta: null, text: QUERY }],
  ])('leaves a fence with %s a code block', (_label, code) => {
    expect(queryBlockOfCode(code)).toBeNull();
  });
});

describe('codeOfQueryBlock', () => {
  it('is the same fence as a code block, where only a code block can stand', () => {
    expect(codeOfQueryBlock(queryBlockNode(QUERY))).toEqual({
      type: 'codeBlock',
      attrs: { language: 'atlas-query' },
      content: [{ type: 'text', text: QUERY }],
    });
    expect(nestedBlockOf(queryBlockNode(QUERY))).toEqual(codeOfQueryBlock(queryBlockNode(QUERY)));
  });

  it('holds no text node for an empty block, which ProseMirror refuses', () => {
    expect(codeOfQueryBlock(queryBlockNode(''))).toEqual({
      type: 'codeBlock',
      attrs: { language: 'atlas-query' },
    });
  });

  it('is null for any other block', () => {
    expect(codeOfQueryBlock({ type: 'codeBlock', attrs: { language: 'atlas-query' } })).toBeNull();
  });
});

describe('queryBlockText', () => {
  it('is the text the node holds, or nothing when it holds none', () => {
    expect(queryBlockText(queryBlockNode(QUERY))).toBe(QUERY);
    expect(queryBlockText({ type: 'queryBlock' })).toBe('');
  });
});

describe('a query block carries a block id', () => {
  it('on a line of its own after it, as a code block does', () => {
    expect(anchorStyleOf(queryBlockNode(QUERY))).toBe('line');
  });
});

describe('readQueryBlock', () => {
  it('is a table of the whole text when there is no layout line', () => {
    expect(readQueryBlock(QUERY)).toEqual({ ok: true, layout: 'table', query: QUERY });
  });

  it.each([
    ['table', `layout: table\n${QUERY}`, 'table'],
    ['list', `layout: list\n${QUERY}`, 'list'],
    ['list, with blank lines and spaces around it', `\n  \n  layout:list  \n${QUERY}`, 'list'],
    ['list, the file’s lines ending in CRLF', `layout: list\r\n${QUERY}`, 'list'],
  ])('reads the layout %s and the query after it', (_label, text, layout) => {
    expect(readQueryBlock(text)).toEqual({ ok: true, layout, query: QUERY });
  });

  it('reads only the first line as the layout', () => {
    const text = `${QUERY}\nlayout: list`;
    expect(readQueryBlock(text)).toEqual({ ok: true, layout: 'table', query: text });
  });

  it.each([
    ['board', 'layout: board', 'A query block shows a table or a list; “board” is neither.'],
    ['Table', 'layout: Table', 'A query block shows a table or a list; “Table” is neither.'],
    ['nothing', 'layout:', 'Say how to show the rows after layout: — table or list.'],
  ])('refuses the layout %s', (_label, line, problem) => {
    expect(readQueryBlock(`${line}\n${QUERY}`)).toEqual({ ok: false, problem });
  });

  it.each([
    ['nothing', ''],
    ['blank lines', '\n  \n'],
    ['a layout and nothing after it', 'layout: list\n\n'],
  ])('says a block holding %s has no query yet', (_label, text) => {
    const reading = readQueryBlock(text);
    expect(reading.ok).toBe(false);
    expect(!reading.ok && reading.problem).toMatch(/^This query block has no query yet\./);
  });
});
