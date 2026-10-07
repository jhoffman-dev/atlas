import { describe, expect, it } from 'vitest';
import { splitWikiLinksAndEmbeds } from '@atlas/domain';
import type { Nodes } from 'mdast';
import { parseBodyToMdast } from './markdown-blocks.ts';
import { textRangesOf } from './text-ranges.ts';

/** The wiki links the parser finds in `markdown`, as written. */
function linksIn(markdown: string): string[] {
  const found: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'wikiLink') found.push(node.value);
    else if ('children' in node) (node.children as Nodes[]).forEach(visit);
  };
  visit(parseBodyToMdast(markdown));
  return found;
}

/** The links `splitWikiLinksAndEmbeds` reads in the same text, as written. */
const linksByGrammar = (text: string): string[] =>
  splitWikiLinksAndEmbeds(text).flatMap((piece) =>
    piece.kind === 'text'
      ? []
      : [
          `${piece.embed ? '!' : ''}[[${piece.target}${piece.heading ?? ''}${piece.alias === null ? '' : `|${piece.alias}`}]]`,
        ],
  );

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe('a wiki link is one token', () => {
  it('reads the links the domain grammar reads, in 2000 seeded lines of brackets', () => {
    const alphabet = ['[', '[[', ']', ']]', '|', '#', '!', 'a', ' ', 'b'];
    const differing: string[] = [];
    for (let seed = 1; seed <= 2000; seed += 1) {
      const random = mulberry32(seed);
      const length = 1 + Math.floor(random() * 12);
      // A letter first, so the line is never a heading, a list or a quote.
      const line = `x${Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')}`;
      const read = linksIn(line);
      if (JSON.stringify(read) !== JSON.stringify(linksByGrammar(line)))
        differing.push(`${JSON.stringify(line)} read ${JSON.stringify(read)}`);
    }
    expect(differing.slice(0, 5), `${differing.length} of 2000 lines`).toEqual([]);
  });

  it('keeps markup inside a link as its name', () => {
    expect(linksIn('a [[_draft_]] b *[[x*y]]* c [[p`q`]]')).toEqual([
      '[[_draft_]]',
      '[[x*y]]',
      '[[p`q`]]',
    ]);
  });

  // A code span that opens in a link and closes after it wins, as in CommonMark (A21-04).
  it('reads no link where a code span opens inside one and closes after it', () => {
    expect(linksIn('a [[r`s]] t` u')).toEqual([]);
  });

  it('does not read escaped brackets, an empty link, or one over a line break', () => {
    expect(linksIn('\\[\\[x]] and [[]] and [[ ]] and [[a\nb]]')).toEqual([]);
  });

  it('reads a link to a heading of the same note, and an embed', () => {
    expect(linksIn('see [[#Plans]] and ![[Pic]]')).toEqual(['[[#Plans]]', '![[Pic]]']);
  });

  // The node holds the link as written; the grammar reads `\|` as the alias's pipe.
  it('reads a table cell’s escaped pipe as the alias’s', () => {
    const cell = '| a |\n| - |\n| [[Note\\|shown]] |';
    expect(linksIn(cell)).toEqual(['[[Note\\|shown]]']);
    expect(linksByGrammar(cell)).toEqual(['[[Note|shown]]']);
  });
});

describe('text runs around a wiki link', () => {
  it('keeps a link inside the run of text around it, as the file has it', () => {
    const body = 'See [[Page]]#heading now';
    expect(textRangesOf(parseBodyToMdast(body))).toEqual([{ start: 0, end: body.length }]);
  });

  it('still ends a run at a link to a web page', () => {
    const body = 'a [w](http://x) b';
    expect(
      textRangesOf(parseBodyToMdast(body)).map(({ start, end }) => body.slice(start, end)),
    ).toEqual(['a ', ' b']);
  });
});
