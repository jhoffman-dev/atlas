import { describe, expect, it } from 'vitest';
import { citeAnswer } from '@dfai/domain';
import type { Nodes } from 'mdast';
import { parseBodyToMdast } from '../markdown/markdown-blocks.ts';

/**
 * Verification of PR #547 (#37): Ask's block reader against the editor's
 * parser. Ask exempts headings, rules and fenced code from the citation rule;
 * a word the editor draws as prose (a paragraph, an item, a quote, a table)
 * must not be exempt in Ask, nor go undrawn — else a saved chat shows the
 * reader an uncited claim Ask never flagged.
 */

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

/** Line shapes a model writes; `W` becomes a word of its own, `w<n>`. */
const SHAPES = [
  'W',
  '- W',
  '1. W',
  '2. W',
  '  - W',
  '> W',
  '> - W',
  '# W',
  '===',
  '---',
  '-',
  '```',
  '  ```',
  '> ```',
  '| W | W |',
  '|---|---|',
  '',
  '***',
];

/** Where the editor draws each word: in a heading, in code, or as prose. */
function editorKinds(node: Nodes, under: string, out: Map<string, string>): void {
  const here = node.type === 'heading' || node.type === 'code' ? node.type : under;
  if ('value' in node && typeof node.value === 'string') {
    for (const word of node.value.match(/w\d+/g) ?? []) out.set(word, here);
  }
  if ('children' in node)
    for (const child of node.children as Nodes[]) editorKinds(child, here, out);
}

/** Where Ask puts each word it draws: the kind of its block. */
function askKinds(answer: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of citeAnswer(answer)) {
    for (const piece of block.inline) {
      const text = 'text' in piece ? piece.text : piece.label;
      for (const word of text.match(/w\d+/g) ?? []) out.set(word, block.kind);
    }
  }
  return out;
}

describe('Ask’s blocks against the editor’s (PR #547)', () => {
  it('judges every word the editor draws as prose, on small random answers', () => {
    const random = mulberry32(547);
    const escaped: string[] = [];
    for (let run = 0; run < 3000; run += 1) {
      let word = 0;
      const lines = Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
        (SHAPES[Math.floor(random() * SHAPES.length)] as string).replace(/W/g, () => `w${word++}`),
      );
      const answer = lines.join('\n');
      const editor = new Map<string, string>();
      editorKinds(parseBodyToMdast(answer), 'prose', editor);
      const ask = askKinds(answer);
      for (const [token, kind] of editor) {
        const judged = ['paragraph', 'item', 'quote', 'table'].includes(ask.get(token) ?? '');
        if (kind === 'prose' && !judged)
          escaped.push(`${JSON.stringify(answer)}: ${token} is ${ask.get(token) ?? 'not drawn'}`);
      }
    }
    expect(escaped.slice(0, 5)).toEqual([]);
  });
});
