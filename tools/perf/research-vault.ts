/*
 * The research views' fixture (#507): 2,000 literature notes holding 20,000
 * highlights between them, with 8 projects they are filed under — "2,008
 * notes indexed", as the main fixture's count reads. Every name is invented
 * (the repository is public), and every note is the same from one run to the
 * next: the only randomness is a seeded generator.
 */
import { literatureNote } from '../../e2e/research-notes.ts';
import type { FixtureFile } from './fixture-vault.ts';

export const RESEARCH_SOURCES = 2000;
export const HIGHLIGHTS_PER_SOURCE = 10;
const PROJECTS = 8;

const WORDS = [
  'harbour',
  'ledger',
  'lantern',
  'meadow',
  'quarry',
  'beacon',
  'orchard',
  'compass',
  'saltmarsh',
  'kiln',
  'tidewater',
  'granary',
  'foundry',
  'heron',
  'juniper',
  'Larkspur',
];
const AUTHORS = ['Mara Quill', 'Tobias Fenn', 'Ines Ashgrove', 'Odile Marlow', 'Wren Thistle'];
const KINDS = ['pdf', 'epub', 'kindle'] as const;
const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'] as const;
const TAGS = ['history', 'craft', 'strategy', 'nature'];

/** A small seeded generator (mulberry32), as the main fixture's. */
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

/** A block id from a counter: six lower-case letters and digits, each its own. */
const idOf = (count: number) => `h${count.toString(36).padStart(5, '0')}`;

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Every file of the research fixture: the projects, then the sources. */
export function researchVault(seed = 507): FixtureFile[] {
  const random = seeded(seed);
  const pick = <T>(from: readonly T[]): T => from[Math.floor(random() * from.length)] as T;
  const words = (count: number) => Array.from({ length: count }, () => pick(WORDS)).join(' ');
  const projects = Array.from({ length: PROJECTS }, (_, at) => `Reading ${at + 1}`);
  let count = 0;
  const sources = Array.from({ length: RESEARCH_SOURCES }, (_, at): FixtureFile => {
    const kind = pick(KINDS);
    const title = `${capitalised(words(3))} ${at + 1}`;
    return {
      path: `Library/${title}.md`,
      contents: literatureNote({
        title,
        author: pick(AUTHORS),
        kind,
        tags: [pick(TAGS)],
        project: pick(projects),
        highlights: Array.from({ length: HIGHLIGHTS_PER_SOURCE }, (_, place) => {
          count += 1;
          return {
            id: idOf(count),
            quote: `${capitalised(words(12))}.`,
            ...(random() < 0.4 && { comment: `${capitalised(words(8))}.` }),
            color: pick(COLORS),
            at: place * 7 + 1,
          };
        }),
      }),
    };
  });
  return [
    ...projects.map((name) => ({
      path: `Projects/${name}.md`,
      contents: '---\ntype: project\n---\n\nBooks to read.\n',
    })),
    ...sources,
  ];
}
