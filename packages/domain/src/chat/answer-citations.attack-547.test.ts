/**
 * Attack on PR #547 (#37): answers the citation rule judges cited that are
 * not, or not cited that are, and the rule's cost on a long answer. Fictional
 * data only (Larkspur Payroll, Mara Quill, Tobias Fenn).
 */

import { describe, expect, it } from 'vitest';
import { scanMarkdown } from '../markdown/wikilink-spans.ts';
import { citeAnswer, uncitedCount } from './answer-citations.ts';

const judged = (answer: string) =>
  citeAnswer(answer).map((block) => `${block.kind}:${block.citation}`);

describe('citeAnswer, attacked (PR #547)', () => {
  it('a line opening with a code span written in triple backticks is not a fence, so the claims after it are still judged', () => {
    // CommonMark: a backtick fence's info string may not hold a backtick, so
    // this first line is a paragraph with a code span, not an opening fence.
    const answer =
      '```ls``` lists the Larkspur payroll files [[Runbook#^t1]].\n\nTobias Fenn owns the tax filing.';
    expect(judged(answer)).toEqual(['paragraph:cited', 'paragraph:uncited']);
  });

  it('a link to a heading or block with no note in it, [[#^t0003]], cites nothing', () => {
    // Ask is on no note, so `[[#^t0003]]` follows to "No note called """: no source.
    expect(judged('Mara Quill approved the Larkspur payroll run [[#^t0003]].')).toEqual([
      'paragraph:uncited',
    ]);
    expect(judged('Mara Quill approved the Larkspur payroll run [[#Decisions]].')).toEqual([
      'paragraph:uncited',
    ]);
  });

  it('each list item in a quote must cite on its own, as each list item does outside one', () => {
    const answer =
      '> - Mara Quill owns payroll [[Larkspur#^t1]]\n> - Tobias Fenn owns the tax filing';
    expect(uncitedCount(citeAnswer(answer))).toBe(1);
  });

  it('a citation whose label is only invisible characters is not a citation the reader can see or follow', () => {
    expect(judged('Mara Quill approved the run [[​]].')).toEqual(['paragraph:uncited']);
  });

  it('a citation chip’s label holds no bidi override, which would draw [[‮flodnaR]] as another note’s name', () => {
    const [block] = citeAnswer('Mara Quill approved the run [[‮flodnaR]].');
    const labels = (block?.inline ?? []).flatMap((piece) =>
      piece.kind === 'cite' ? [piece.label] : [],
    );
    expect(labels).toHaveLength(1);
    expect(labels.join('')).not.toMatch(/[‪-‮⁦-⁩]/);
  });

  it('a paragraph that states a claim before its closing lead-in is still judged', () => {
    // Exempt is for "a line that only leads into the list under it", not a claim with a colon on the end.
    const answer =
      'Mara Quill moved the Larkspur payroll run to Friday. The steps were:\n- Tobias Fenn signs off [[Runbook#^t1]]\n- Ida Brenwick sends the file [[Runbook#^t2]]';
    expect(judged(answer)[0]).toBe('paragraph:uncited');
  });

  it('a setext heading is a heading, exempt, not an uncited paragraph', () => {
    expect(judged('Summary\n=======\n\nMara Quill owns payroll [[Larkspur#^t1]].')).toEqual([
      'heading:exempt',
      'paragraph:cited',
    ]);
  });

  it('a wrapped line starting "2026." does not cut the paragraph into an uncited one and an item', () => {
    // CommonMark: only a list starting at 1 may interrupt a paragraph.
    const answer =
      'Tobias Fenn joined Larkspur Payroll in\n2026. He owns the tax filing [[People#^t4]].';
    expect(judged(answer)).toEqual(['paragraph:cited']);
  });

  it('reads a long single-line answer in linear time', () => {
    // A streamed answer is re-read on every word, so a quadratic read freezes the page.
    const answer = '[a]('.repeat(40_000);
    const started = performance.now();
    citeAnswer(answer);
    // 160,000 characters: linear reads take a few ms; the quadratic one takes seconds.
    expect(performance.now() - started).toBeLessThan(1000);
  }, 60_000);
});

/** mulberry32: a seeded random source, so every run draws the same answers. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  'Mara',
  ' payroll ',
  '[[Larkspur]]',
  '[[Runbook#^t1]]',
  '[[Runbook|the runbook]]',
  '![[Chart]]',
  '[[',
  ']]',
  '`',
  '``',
  '\\',
  '|',
  '#',
  '<!--',
  '-->',
  ' ',
  'Tobias',
];

function draw(random: () => number, length: number): string {
  let text = 'Mara';
  for (let at = 0; at < length; at += 1) text += TOKENS[Math.floor(random() * TOKENS.length)];
  return text;
}

/** Whether the editor reads a link to a note in `[start, end)` of `markdown`. */
function editorCites(markdown: string, start: number, end: number): boolean {
  return scanMarkdown(markdown).links.some(
    (span) => span.start >= start && span.end <= end && span.link.target.trim() !== '',
  );
}

describe('citeAnswer agrees with the editor’s reading of links (seeded property)', () => {
  const random = seeded(Number(process.env['ASK_CITE_PROPERTY_SEED'] ?? 20261023));

  it('a one-paragraph answer is cited exactly when the editor reads a link to a note in it', () => {
    const disagreements: string[] = [];
    for (let run = 0; run < 2000; run += 1) {
      const answer = draw(random, 1 + Math.floor(random() * 12));
      const cited = citeAnswer(answer)[0]?.citation === 'cited';
      if (cited !== editorCites(answer, 0, answer.length)) disagreements.push(answer);
    }
    expect(disagreements.slice(0, 5)).toEqual([]);
  });

  it('each item of a list is cited exactly when the editor reads a link to a note on its line', () => {
    const disagreements: string[] = [];
    for (let run = 0; run < 1000; run += 1) {
      const items = Array.from({ length: 2 + Math.floor(random() * 3) }, () =>
        draw(random, 1 + Math.floor(random() * 8)),
      );
      const answer = items.map((item) => `- ${item}`).join('\n');
      const blocks = citeAnswer(answer);
      let offset = 0;
      items.forEach((item, at) => {
        const start = offset + 2;
        offset = start + item.length + 1;
        const cited = blocks[at]?.citation === 'cited';
        if (cited !== editorCites(answer, start, start + item.length)) disagreements.push(answer);
      });
    }
    expect([...new Set(disagreements)].slice(0, 5)).toEqual([]);
  });
});
