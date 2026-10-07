import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../markdown/editor-node.ts';
import {
  escapeHtml,
  NOTE_PAGE_CSP,
  notePageDocument,
  pageImageSources,
  withInlinedImages,
} from './note-page.ts';

const image = (src: string) => ({ type: 'image', attrs: { src, alt: '' } });

const DOC: EditorDocument = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [image('a.png'), { type: 'text', text: 'hi' }] },
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [image('https://x.test/b.png')] }],
    },
    { type: 'paragraph', content: [image('a.png')] },
  ],
};

describe('the page document', () => {
  it('puts the policy first after the doctype, before anything the note wrote', () => {
    const html = notePageDocument({ title: 'Dune', bodyHtml: '<p>x</p>', styles: 'p{}' });
    expect(html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(html).toContain(`content="${NOTE_PAGE_CSP}"`);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'));
    expect(html).toContain('<div class="page__body"><p>x</p></div>');
  });

  it('lets nothing run and nothing be fetched', () => {
    for (const rule of [
      "default-src 'none'",
      "script-src 'none'",
      "connect-src 'none'",
      'img-src data: blob:',
      'font-src data:',
      "base-uri 'none'",
    ]) {
      expect(NOTE_PAGE_CSP).toContain(rule);
    }
    expect(NOTE_PAGE_CSP).not.toMatch(/https?:/);
  });

  it('escapes the title, and a style that tries to close itself', () => {
    const html = notePageDocument({
      title: '<img onerror=x> & "q"',
      bodyHtml: '',
      styles: 'a{}</style><script>x()</script>',
    });
    expect(html).toContain('<title>&lt;img onerror=x&gt; &amp; &quot;q&quot;</title>');
    expect(html).not.toContain('</style><script>');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });

  it('escapes the five characters HTML reads', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('images written into the page', () => {
  it('lists each source once, however deep', () => {
    expect(pageImageSources(DOC)).toEqual(['a.png', 'https://x.test/b.png']);
  });

  it('replaces each source with its picture, and leaves out one that could not be read', () => {
    const inlined = withInlinedImages(DOC, new Map([['a.png', 'data:image/png;base64,AAAA']]));
    expect(pageImageSources(inlined)).toEqual(['data:image/png;base64,AAAA']);
    // The web image is gone, not kept pointing at the web.
    expect(JSON.stringify(inlined)).not.toContain('x.test');
    // Everything else is as it was.
    expect(inlined.content[0]?.content?.[1]).toEqual({ type: 'text', text: 'hi' });
    expect(inlined.content[1]?.content?.[0]).toEqual({ type: 'listItem', content: [] });
  });
});
