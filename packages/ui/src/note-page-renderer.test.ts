// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '@atlas/domain';
import { createNotePageRenderer, notePageStyles } from './note-page-renderer.ts';

const DOC: EditorDocument = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plot' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Spice <b>must</b> flow & ', marks: [{ type: 'bold' }] },
        { type: 'wikiLink', attrs: { target: 'Arrakis', alias: null } },
      ],
    },
    {
      type: 'rawBlock',
      attrs: { markdown: '<script>alert(1)</script>\n<img src=x onerror=alert(2)>' },
    },
    { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'sand' } },
  ],
};

describe('the note page renderer', () => {
  const renderer = createNotePageRenderer({ fontUrl: null });
  const html = renderer.bodyHtml(DOC);

  it('draws the body through the reading schema', () => {
    expect(html).toContain('<h2>Plot</h2>');
    expect(html).toContain('<strong>Spice &lt;b&gt;must&lt;/b&gt; flow &amp; </strong>');
    expect(html).toContain('data-wikilink="Arrakis"');
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="sand">');
  });

  it('draws a bookmark as its link on a card, which still opens the note', () => {
    const withCard = renderer.bodyHtml({
      type: 'doc',
      content: [
        { type: 'bookmark', attrs: { target: 'Arrakis', heading: null, alias: 'the planet' } },
      ],
    });
    // Its alias is written too, so a copy of the card pastes as the same link.
    expect(withCard).toMatch(
      /<div class="bookmark bookmark--plain" data-bookmark="Arrakis" data-alias="the planet">/,
    );
    expect(withCard).toContain('data-wikilink="Arrakis"');
    expect(withCard).toContain('>the planet</a>');
  });

  it('draws a query block as the code Obsidian shows, its text escaped and nothing run', () => {
    const withQuery = renderer.bodyHtml({
      type: 'doc',
      content: [{ type: 'queryBlock', attrs: { text: "FROM task WHERE title = '<b>'" } }],
    });
    expect(withQuery).toContain(
      '<pre data-query-block="" class="query-block query-block--plain"><code>FROM task WHERE title = \'&lt;b&gt;\'</code></pre>',
    );
  });

  it('shows raw HTML as its source, as the editor does, and never as markup', () => {
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img[^>]*onerror/i);
  });

  it('writes the font into the page, or falls back to the system face without one', () => {
    const withFont = notePageStyles('data:font/woff2;base64,d09G');
    expect(withFont).toContain('@font-face');
    expect(withFont).toContain('src:url("data:font/woff2;base64,d09G")');
    expect(renderer.styles).not.toContain('@font-face');
    expect(renderer.styles).toContain("font-family:'Manrope Variable'");
    // Light, whatever the app's theme: the page is pictured as it is printed.
    expect(renderer.styles).toContain('background:#ffffff');
    expect(renderer.styles).not.toMatch(/url\((?!")/);
  });
});
