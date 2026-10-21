import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorMark, EditorNode } from '../markdown/editor-node.ts';
import { missingTransclusion } from '../transclusion/transclusion-card.ts';
import { exportStandalone, type StandaloneSources } from './index.ts';

/**
 * Property (#501): whatever a note's links, embeds and pictures, a
 * standalone export holds no wiki link at all; each link to a note exported
 * beside it becomes one link to that note's file, keeping its look, and each
 * link to any other note its words, never a link; a picture in the vault is
 * its copy, or words where it had none, and one on the web is untouched;
 * each whole note embedded alone in a paragraph is quoted once; and the
 * note read is never changed.
 */

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seeded(20261021);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const chance = (p: number) => random() < p;
const count = (max: number) => Math.floor(random() * (max + 1));

const EXPORTED: Readonly<Record<string, string>> = {
  'Mara Quill': 'Mara%20Quill.md',
  Kickoff: 'Kickoff.md',
  'Larkspur Payroll': 'Larkspur%20Payroll.md',
};
const NOT_EXPORTED = ['Tobias Fenn', 'Q3 plan', 'Café (draft)'];
const EMBEDDABLE = ['Weekly notes', 'Retro'];
const IMAGES = ['plan.png', 'attachments/chart one.jpg', 'missing.gif'];
const WEB_IMAGES = ['https://example.com/a.png'];
const MARKS: readonly EditorMark[] = [{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }];

const text = (value: string, marks?: readonly EditorMark[]): EditorNode => ({
  type: 'text',
  text: value,
  ...(marks !== undefined && marks.length > 0 && { marks }),
});

function wikiLink(): EditorNode {
  const target = pick([...Object.keys(EXPORTED), ...NOT_EXPORTED]);
  const embedImage = chance(0.15);
  // An embed in a sentence, even of a note exported beside it, is words, not a link.
  const embedNote = !embedImage && chance(0.1);
  return {
    type: 'wikiLink',
    attrs: {
      target: embedImage ? pick(IMAGES) : target,
      heading: chance(0.2) ? '#Agenda' : null,
      alias: chance(0.3) ? `${target} (alias)` : null,
      ...((embedImage || embedNote) && { embed: true }),
    },
    ...(chance(0.3) && { marks: [pick(MARKS)] }),
  };
}

function inline(): EditorNode {
  const roll = random();
  if (roll < 0.45) return text(pick(['Notes on ', 'and ', 'see ', 'agreed. ']));
  if (roll < 0.85) return wikiLink();
  return {
    type: 'image',
    attrs: { src: pick([...IMAGES, ...WEB_IMAGES]), alt: 'pic', title: null },
  };
}

function block(depth: number): EditorNode {
  const roll = random();
  if (roll < 0.15) {
    const target = pick(EMBEDDABLE);
    return {
      type: 'paragraph',
      content: [{ type: 'wikiLink', attrs: { target, heading: null, alias: null, embed: true } }],
    };
  }
  if (roll < 0.3 && depth < 2) {
    return {
      type: 'blockquote',
      content: Array.from({ length: 1 + count(2) }, () => block(depth + 1)),
    };
  }
  if (roll < 0.4 && depth < 2) {
    const item = (): EditorNode => ({ type: 'listItem', content: [block(depth + 1)] });
    return { type: 'bulletList', content: Array.from({ length: 1 + count(2) }, item) };
  }
  return { type: 'paragraph', content: Array.from({ length: 1 + count(4) }, inline) };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

function walk(nodes: readonly EditorNode[], each: (node: EditorNode) => void): void {
  for (const node of nodes) {
    each(node);
    walk(node.content ?? [], each);
  }
}

/** A note embedded whole, which embeds one back: the export opens one level, never the second. */
const EMBEDDED_DOC: EditorDocument = deepFreeze({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [text('From the embed '), wikiLink(), wikiLink()] },
    {
      type: 'paragraph',
      content: [
        { type: 'wikiLink', attrs: { target: 'Retro', heading: null, alias: null, embed: true } },
      ],
    },
  ],
});

const sources: StandaloneSources = {
  titleOf: (target) => (target in EXPORTED || NOT_EXPORTED.includes(target) ? target : null),
  shown: missingTransclusion,
  readRaw: () => [],
  hrefOf: (target) => EXPORTED[target] ?? null,
  imageSrc: (src) => (src.startsWith('missing') ? null : `copied/${encodeURIComponent(src)}`),
  embedded: (link) =>
    EMBEDDABLE.includes(link.target) ? { title: link.target, doc: EMBEDDED_DOC } : null,
};

const isCopied = (src: string) => IMAGES.includes(src) && !src.startsWith('missing');

/** Links to exported notes and pictures copied, in blocks taken as they stand (no embed opened). */
function countIn(nodes: readonly EditorNode[]) {
  let links = 0;
  let pictures = 0;
  walk(nodes, (node) => {
    const target = String(node.attrs?.['target'] ?? '');
    const embed = node.attrs?.['embed'] === true;
    if (node.type === 'wikiLink' && !embed && target in EXPORTED) links += 1;
    if (node.type === 'wikiLink' && embed && isCopied(target)) pictures += 1;
    if (node.type === 'image' && isCopied(String(node.attrs?.['src']))) pictures += 1;
  });
  return { links, pictures };
}

/** What the export must make of the note, counted from the note itself. */
function expected(body: EditorDocument) {
  const own = countIn(body.content);
  const inner = countIn(EMBEDDED_DOC.content);
  let embeds = 0;
  walk(body.content, (node) => {
    const [only, ...rest] = node.content ?? [];
    const target = String(only?.attrs?.['target'] ?? '');
    if (
      node.type === 'paragraph' &&
      rest.length === 0 &&
      only?.attrs?.['embed'] === true &&
      EMBEDDABLE.includes(target)
    ) {
      embeds += 1;
    }
  });
  return {
    toExported: own.links + embeds * inner.links,
    pictures: own.pictures + embeds * inner.pictures,
    embeds,
  };
}

describe('exportStandalone, property (#501)', () => {
  it('rewrites every link, picture and embed, whatever the note holds', () => {
    const hrefs = new Set(Object.values(EXPORTED));
    for (let run = 0; run < 300; run += 1) {
      const body: EditorDocument = deepFreeze({
        type: 'doc',
        content: Array.from({ length: 1 + count(5) }, () => block(0)),
      });
      const before = JSON.stringify(body);
      const result = exportStandalone({ doc: body, title: 'Notes', sources });
      const want = expected(body);

      let linked = 0;
      let quoted = 0;
      let pictures = 0;
      walk(result.doc.content, (node) => {
        expect(node.type, `run ${run}`).not.toBe('wikiLink');
        for (const mark of node.marks ?? []) {
          const href = mark.attrs?.['href'];
          if (mark.type === 'link' && typeof href === 'string') {
            expect(hrefs.has(href), `run ${run}: ${href}`).toBe(true);
            linked += 1;
          }
        }
        if (node.type === 'image') {
          const src = String(node.attrs?.['src']);
          expect(src.startsWith('copied/') || WEB_IMAGES.includes(src), `run ${run}: ${src}`).toBe(
            true,
          );
          if (src.startsWith('copied/')) pictures += 1;
        }
        if (
          node.type === 'text' &&
          node.text?.startsWith('From ') &&
          node.marks?.[0]?.type === 'italic'
        ) {
          quoted += 1;
        }
        // Words never carry the markup a link was written in.
        expect(node.text ?? '', `run ${run}`).not.toContain('[[');
      });
      expect(linked, `run ${run}`).toBe(want.toExported);
      expect(quoted, `run ${run}`).toBe(want.embeds);
      expect(pictures, `run ${run}`).toBe(want.pictures);
      expect(JSON.stringify(body), `run ${run}`).toBe(before);
    }
  });
});
