import { describe, expect, it } from 'vitest';
import {
  notesAfterMove,
  retargetLinks,
  splitWikiLinksAndEmbeds,
  type VaultPath,
} from '@atlas/domain';
import type { Nodes, Root } from 'mdast';
import { parseBodyToMdast } from './markdown-blocks.ts';

/**
 * One wiki-link grammar (A21-04, ADR-0004): for generated note bodies, the
 * links the index finds in the raw text (`splitWikiLinks`, as `linksIn` in
 * `refresh-index.ts` reads them) are exactly the `wikiLink` nodes the
 * editor's parser reads, and a rename rewrites exactly those.
 *
 * The bodies hold escapes, code spans and fences, comments, links broken over
 * a line, backticks inside names and `\|` aliases, in paragraphs, headings,
 * lists, quotes, callouts and tables. Left out, because the raw-text grammar
 * does not model the block they need: HTML blocks and tags, autolinks,
 * indented code, and a backtick left open in a list item or a table cell,
 * which markdown closes at the item's or cell's edge.
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

type Random = () => number;

const pick = <T>(random: Random, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)]!;

/** Words safe anywhere, a table cell included. */
const WORDS = [
  'word',
  '[[Note]]',
  '[[Note|shown]]',
  '[[Note#Part]]',
  '![[Note]]',
  '[[Other]]',
  '[[a`b]]',
  '[[Note`]]',
  '\\[[Note]]',
  '\\\\[[Note]]',
  '\\![[Note]]',
  '`[[Note]]`',
  '``a`[[Note]]``',
  '[[Note\\|shown]]',
  '[[a\\`b]]',
  '<!-- [[Note]] -->',
  '[[a<!--b]]',
  '[[]]',
  '[[Note',
  ']]',
  '**[[Note]]**',
  '*x*',
  '#tag',
  '$x$',
  '&amp;',
];

/** Words that can leave a code span open for markdown to close further on. */
const LOOSE = ['`', 'a`', '[[Note]]`', '`b'];

const lineOf = (random: Random, words: readonly string[]): string =>
  Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(random, words)).join(
    random() < 0.2 ? '' : ' ',
  );

const anyWords = [...WORDS, ...LOOSE];

const cellOf = (random: Random): string => lineOf(random, WORDS).replace(/(?<!\\)\|/g, '\\|');

function blockOf(random: Random, eol: string): string {
  switch (Math.floor(random() * 9)) {
    case 0:
      return `${'#'.repeat(1 + Math.floor(random() * 6))} ${lineOf(random, anyWords)}`;
    case 1:
      return [`- ${lineOf(random, WORDS)}`, `- ${lineOf(random, WORDS)}`].join(eol);
    case 2:
      return ['| h | h |', '| - | - |', `| ${cellOf(random)} | ${cellOf(random)} |`].join(eol);
    case 3:
      return [`> [!note] ${lineOf(random, WORDS)}`, `> ${lineOf(random, anyWords)}`].join(eol);
    case 4:
      return [`> ${lineOf(random, anyWords)}`, `> ${lineOf(random, anyWords)}`].join(eol);
    case 5:
      return ['```', lineOf(random, WORDS), '```'].join(eol);
    case 6:
      // A link broken over a line, which is no link.
      return `${lineOf(random, anyWords)} [[Note${eol}Note]] ${lineOf(random, anyWords)}`;
    default:
      return [lineOf(random, anyWords), lineOf(random, anyWords)].join(eol);
  }
}

function noteOf(seed: number): string {
  const random = mulberry32(seed);
  const eol = random() < 0.5 ? '\r\n' : '\n';
  const blocks = Array.from({ length: 1 + Math.floor(random() * 4) }, () => blockOf(random, eol));
  return `${blocks.join(eol + eol)}${eol}`;
}

interface FoundLink {
  readonly target: string;
  readonly heading: string | null;
  readonly alias: string | null;
  readonly embed: boolean;
}

const asFound = ({ target, heading, alias, embed }: FoundLink): FoundLink => ({
  target,
  heading,
  alias,
  embed,
});

const inIndex = (body: string): FoundLink[] =>
  splitWikiLinksAndEmbeds(body).flatMap((piece) =>
    piece.kind === 'wikiLink' ? [asFound(piece)] : [],
  );

function inEditor(body: string): FoundLink[] {
  const found: FoundLink[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'wikiLink') {
      const [link] = splitWikiLinksAndEmbeds(node.value);
      if (link?.kind === 'wikiLink') found.push(asFound(link));
      else
        found.push({
          target: `unreadable ${node.value}`,
          heading: null,
          alias: null,
          embed: false,
        });
    } else if ('children' in node) node.children.forEach(visit);
  };
  visit(parseBodyToMdast(body) as Root);
  return found;
}

function renamed(body: string): { text: string; count: number } {
  return retargetLinks({
    text: body,
    path: 'Holder.md' as VaultPath,
    exists: () => false,
    ...notesAfterMove({ from: 'Note.md' as VaultPath, to: 'Renamed.md' as VaultPath }, [
      'Note.md',
      'Other.md',
      'Holder.md',
    ] as VaultPath[]),
  });
}

const SEEDS = 1500;

describe('the index, the editor and a rename read the same wiki links', () => {
  it(`for ${SEEDS} generated notes`, () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= SEEDS && problems.length < 6; seed += 1) {
      const body = noteOf(seed);
      const editor = inEditor(body);
      const index = inIndex(body);
      if (JSON.stringify(index) !== JSON.stringify(editor)) {
        problems.push(
          `seed ${seed} ${JSON.stringify(body)}: index ${JSON.stringify(index)}, editor ${JSON.stringify(editor)}`,
        );
        continue;
      }
      const rename = renamed(body);
      // `[[Note ]]` opens Note too: a link's target is matched trimmed.
      const opensNote = (link: FoundLink) => link.target.trim() === 'Note';
      const toNote = editor.filter(opensNote).length;
      const expected = editor.map((link) =>
        opensNote(link) ? { ...link, target: 'Renamed' } : link,
      );
      if (
        rename.count !== toNote ||
        JSON.stringify(inEditor(rename.text)) !== JSON.stringify(expected)
      )
        problems.push(
          `seed ${seed} ${JSON.stringify(body)}: renamed ${rename.count} of ${toNote}, to ${JSON.stringify(rename.text)}`,
        );
    }
    expect(problems).toEqual([]);
  }, 60_000);

  it('can see a difference: a body the two read differently fails the comparison', () => {
    // A guard on the check itself: were the two readings compared wrongly,
    // every seed would pass.
    expect(inIndex('[[Note]]')).not.toEqual(inIndex('[[Other]]'));
    expect(inEditor('[[Note]] [[Other]]')).toHaveLength(2);
  });
});
