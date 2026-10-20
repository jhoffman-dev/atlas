import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { createWikiLinkResolver } from './resolve-wikilink.ts';
import {
  imagePathsToRebase,
  notesAfterMerge,
  rebaseImageSources,
  retargetMergedLinks,
} from './retarget-links.ts';
import { wikiLinkSpans } from './wikilink-spans.ts';

const p = createVaultPath;
const kept = p('People/Mara Quill.md');
const short = p('Mara.md');
const typo = p('Inbox/Marra Quill.md');
const notes = [kept, short, typo, p('Mara Quillon.md'), p('Projects/Payroll.md')];
const across = notesAfterMerge({
  notes,
  into: new Map([
    [short, kept],
    [typo, kept],
  ]),
});
const rewrite = (text: string) => retargetMergedLinks({ text, ...across });

describe('links re-pointed by a merge', () => {
  it('points a link at a merged note at the kept one, by name', () => {
    expect(rewrite('Met [[Mara]] and [[Marra Quill]].')).toEqual({
      text: 'Met [[Mara Quill]] and [[Mara Quill]].',
      count: 2,
    });
  });

  it('keeps display text, a heading, a block and the embed mark; a path stays a path', () => {
    expect(
      rewrite('[[Mara|M]] ![[Mara#Notes]] [[Inbox/Marra Quill#^ab12|see]] ![[Mara#^x]]').text,
    ).toBe(
      '[[Mara Quill|M]] ![[Mara Quill#Notes]] [[People/Mara Quill#^ab12|see]] ![[Mara Quill#^x]]',
    );
  });

  it('rewrites relations, one and many, in the frontmatter', () => {
    const text =
      '---\nowner: "[[Mara]]"\nattendees:\n  - "[[Marra Quill]]"\n  - "[[Payroll]]"\n---\nBody\n';
    expect(rewrite(text).text).toBe(
      '---\nowner: "[[Mara Quill]]"\nattendees:\n  - "[[Mara Quill]]"\n  - "[[Payroll]]"\n---\nBody\n',
    );
  });

  it('leaves a name that only starts the same alone: Mara Quill, Mara Quillon', () => {
    const text = '[[Mara Quill]] [[Mara Quillon]] [[mara quill]]';
    expect(rewrite(text)).toEqual({ text, count: 0 });
  });

  it('matches a link to a merged note by case and composition, as links resolve', () => {
    expect(rewrite('[[mara]] [[MARRA QUILL]]').text).toBe('[[Mara Quill]] [[Mara Quill]]');
  });

  it('leaves links in code, and escaped ones, as they are', () => {
    const text = '`[[Mara]]`\n\n```\n[[Mara]]\n```\n\n\\[[Mara]]\n';
    expect(rewrite(text)).toEqual({ text, count: 0 });
  });

  it('writes the kept note’s path where its name alone would open another note', () => {
    const twin = p('Archive/Mara Quill.md');
    const crowded = notesAfterMerge({
      notes: [kept, short, twin, p('Mara Quill.md')],
      into: new Map([[short, kept]]),
    });
    expect(retargetMergedLinks({ text: '[[Mara]]', ...crowded }).text).toBe(
      '[[People/Mara Quill]]',
    );
  });

  it('leaves a link alone that already opens the kept note once the merged one is gone', () => {
    // `Tobias Fenn.md` at the root and `People/Tobias Fenn.md`: the root one wins the name
    // until it goes, then the kept one does — the link needs no change.
    const root = p('Tobias Fenn.md');
    const people = p('People/Tobias Fenn.md');
    const same = notesAfterMerge({ notes: [root, people], into: new Map([[root, people]]) });
    expect(retargetMergedLinks({ text: '[[Tobias Fenn]] [[Tobias Fenn.md]]', ...same }).count).toBe(
      0,
    );
  });
});

describe('image sources of a body merged into another note', () => {
  it('re-points a relative image at the file it showed from the merged note’s folder', () => {
    const from = p('Inbox/Marra Quill.md');
    const text = '![badge](badge.png) ![logo](https://example.com/logo.png)';
    expect(imagePathsToRebase({ text, from, to: kept })).toContain('Inbox/badge.png');
    const exists = (path: VaultPath) => path === 'Inbox/badge.png';
    expect(rebaseImageSources({ text, from, to: kept, exists })).toEqual({
      text: '![badge](../Inbox/badge.png) ![logo](https://example.com/logo.png)',
      count: 1,
    });
  });

  it('leaves an image that is found nowhere alone', () => {
    const text = '![badge](missing.png)';
    expect(rebaseImageSources({ text, from: short, to: kept, exists: () => false })).toEqual({
      text,
      count: 0,
    });
  });
});

/** mulberry32: a seeded RNG, so every run draws the same documents. */
function rngOf(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('a merge’s link rewrite, over seeded random documents', () => {
  const names = [
    'Mara',
    'mara',
    'MARA',
    'Mara Quill',
    'Marra Quill',
    'Inbox/Marra Quill',
    'Mara Quillon',
    'Payroll',
    'Zoë',
    'Nowhere',
  ];
  const zoe = p('Zoë.md');
  const zoeDecomposed = 'Zoë';
  const vault = [...notes, zoe];
  const merge = notesAfterMerge({
    notes: vault,
    into: new Map([
      [short, kept],
      [typo, kept],
      [zoe, kept],
    ]),
  });
  const before = createWikiLinkResolver(merge.before);
  const after = createWikiLinkResolver(merge.after);

  function randomLink(rng: () => number): string {
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
    const name = rng() < 0.1 ? zoeDecomposed : pick(names);
    const fragment = pick(['', '#Notes', '#^b1', '#Héading']);
    const display = pick(['', '|M', '|Mara Quill', '|the payroll lead']);
    return `${rng() < 0.25 ? '!' : ''}[[${name}${fragment}${display}]]`;
  }

  function randomDocument(rng: () => number): string {
    const pieces: string[] = [];
    if (rng() < 0.5)
      pieces.push(`---\nowner: "${randomLink(rng)}"\nmany:\n  - "${randomLink(rng)}"\n---\n`);
    for (let line = 0; line < 6; line += 1) {
      const filler = ['Met ', 'then ', '`code [[Mara]]` ', 'and ', ''][Math.floor(rng() * 5)];
      pieces.push(`${filler}${randomLink(rng)} words ${randomLink(rng)}\n`);
    }
    return pieces.join('');
  }

  /** The text with every link target cut out: what must not change. */
  const skeleton = (text: string) => {
    let out = '';
    let cursor = 0;
    for (const span of wikiLinkSpans(text)) {
      out += text.slice(cursor, span.targetStart) + '\u0001';
      cursor = span.targetEnd;
    }
    return out + text.slice(cursor);
  };

  it('opens the kept note from every link that opened a merged one, and changes nothing else', () => {
    const rng = rngOf(464);
    for (let run = 0; run < 300; run += 1) {
      const text = randomDocument(rng);
      const { text: rewritten, count } = retargetMergedLinks({ text, ...merge });
      const was = wikiLinkSpans(text);
      const now = wikiLinkSpans(rewritten);
      expect(now).toHaveLength(was.length);
      let changed = 0;
      was.forEach((span, at) => {
        const link = now[at]!.link;
        const opened = before(span.link.target);
        const wanted = opened === null ? null : (merge.moved.get(opened) ?? opened);
        // Every link opens what it opened, or the kept note in place of a merged one.
        expect(after(link.target)).toBe(wanted);
        expect(link.heading ?? null).toBe(span.link.heading ?? null);
        expect(link.alias ?? null).toBe(span.link.alias ?? null);
        expect(link.embed).toBe(span.link.embed);
        if (link.target !== span.link.target) changed += 1;
      });
      expect(count).toBe(changed);
      expect(skeleton(rewritten)).toBe(skeleton(text));
      // A second pass has nothing left to do.
      expect(retargetMergedLinks({ text: rewritten, ...merge }).count).toBe(0);
    }
  });
});
