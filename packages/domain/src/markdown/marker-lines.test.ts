import { describe, expect, it } from 'vitest';
import { withoutMarkerLines } from './index.ts';

const HIGHLIGHT_MARKER = '<!-- atlas:highlight {"v":1,"mark":"highlight","color":"yellow","kind":"pdf","page":3} -->';
const TOMBSTONE =
  '<!-- atlas:highlight-removed {"v":1,"kind":"kindle","location":9,"annotationId":"A9","words":"3f2a"} -->';

describe('a block of markdown without its marker lines', () => {
  it('drops a highlight marker inside a quote, keeping the quote and the comment', () => {
    const block = `> Ferns spread by spores.\n> ${HIGHLIGHT_MARKER}\n>\n> Check the north bed.`;
    expect(withoutMarkerLines(block)).toBe('> Ferns spread by spores.\n>\n> Check the north bed.');
  });

  it('is nothing for a block of tombstones alone', () => {
    expect(withoutMarkerLines(`${TOMBSTONE}\n\n${TOMBSTONE}`)).toBe('');
  });

  it('drops any atlas marker line, of any kind or version', () => {
    expect(withoutMarkerLines('Kale\n<!-- atlas:handled-ledger v9 -->\nChard')).toBe('Kale\nChard');
    expect(withoutMarkerLines('  <!--atlas:summary-start-->')).toBe('');
  });

  it('keeps CRLF line endings on the lines it keeps', () => {
    expect(withoutMarkerLines(`> Quote\r\n> ${HIGHLIGHT_MARKER}\r\n> Comment`)).toBe(
      '> Quote\r\n> Comment',
    );
  });

  it('keeps a line where a marker follows other words', () => {
    const line = `[[Seed list]] <!-- atlas:bookmark -->`;
    expect(withoutMarkerLines(line)).toBe(line);
  });

  it('keeps a line where the comment ends before more words', () => {
    const line = '<!-- atlas:highlight {} --> visible <!-- later -->';
    expect(withoutMarkerLines(line)).toBe(line);
  });

  it('keeps a comment that is no atlas marker, and a table untouched', () => {
    expect(withoutMarkerLines('<!-- a note to self -->')).toBe('<!-- a note to self -->');
    const table = '| Seed | Days |\n| --- | --- |\n| Kale | 55 |';
    expect(withoutMarkerLines(table)).toBe(table);
  });
});
