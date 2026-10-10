import { describe, expect, it } from 'vitest';
import { withWikiLinks } from './page-links.ts';

const TERMS = 'b2000000000000000000000000000001';
const links: Record<string, string> = {
  [TERMS]: 'Renewal terms',
  c3000000000000000000000000000001: 'People/Mara Quill',
};
const linkFor = (id: string) => links[id] ?? null;

describe("a page's links to other pages", () => {
  it('become wiki links to their notes, the text kept as the alias when it differs', () => {
    const body = `See [Renewal terms](../Notes%20x/Renewal%20terms%20${TERMS}.md) and [the owner](https://www.notion.so/Mara-c3000000000000000000000000000001?pvs=21).`;
    expect(withWikiLinks(body, linkFor)).toBe(
      'See [[Renewal terms]] and [[People/Mara Quill|the owner]].',
    );
  });

  it('take no alias that would break the link, or that only repeats the name', () => {
    expect(
      withWikiLinks(`[Mara Quill](https://notion.so/c3000000000000000000000000000001)`, linkFor),
    ).toBe('[[People/Mara Quill]]');
    expect(withWikiLinks(`[a | b](x%20${TERMS}.md)`, linkFor)).toBe('[[Renewal terms]]');
  });

  it('are left as written when the page is not known, the link is an image, or not to a page', () => {
    const body = [
      '[Wiki](https://www.notion.so/Wiki-aa000000000000000000000000000001)',
      `![chart](Renew%20${TERMS}/chart.png)`,
      `![page](x%20${TERMS}.md)`,
      `[site](https://example.com/${TERMS})`,
    ].join('\n');
    expect(withWikiLinks(body, linkFor)).toBe(body);
  });
});
