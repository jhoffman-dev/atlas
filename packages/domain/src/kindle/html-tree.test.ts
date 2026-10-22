import { describe, expect, it } from 'vitest';
import {
  classesOf,
  decodeEntities,
  findAll,
  findFirst,
  isElement,
  MAX_HTML_DEPTH,
  parseHtml,
  parseHtmlDocument,
  textOf,
  withClass,
  withId,
  withTag,
} from './html-tree.ts';

describe('decodeEntities', () => {
  it('reads named, decimal and hex references as their characters', () => {
    expect(decodeEntities('Q &amp; A &lt;b&gt; &quot;x&quot; &apos;y&#39; &#x2019;&rsquo;')).toBe(
      'Q & A <b> "x" \'y\' ’’',
    );
    expect(decodeEntities('a&nbsp;b &mdash; &ndash; &hellip; &ldquo;q&rdquo; &lsquo;s')).toBe(
      'a b — – … “q” ‘s',
    );
  });

  it('leaves an unknown name, a reference with no semicolon and a code point out of range as written', () => {
    expect(decodeEntities('&bogus; &amp &#0; &#x110000; AT&T')).toBe(
      '&bogus; &amp &#0; &#x110000; AT&T',
    );
  });

  it('reads the named references an accented or typeset book is written with', () => {
    expect(
      decodeEntities('caf&eacute; na&iuml;ve &Eacute;cole &euro;5 &copy; &frac12; &sup2;'),
    ).toBe('café naïve École €5 © ½ ²');
    expect(
      decodeEntities('&auml;&ouml;&uuml;&szlig; &ntilde; &ccedil; &oslash; &aring; &aelig;'),
    ).toBe('äöüß ñ ç ø å æ');
    expect(
      decodeEntities('&alpha;&beta;&Omega; &rarr; &hearts; &there4; &check; &bull; &dagger;'),
    ).toBe('αβΩ → ♥ ∴ ✓ • †');
  });

  it('keeps the case of a name, as HTML does: Eacute is not eacute', () => {
    expect(decodeEntities('&Eacute; &eacute; &AMP; &LT;')).toBe('É é & <');
  });

  it('reads a reference that stands for two characters, and a numeric one in the old Windows range', () => {
    expect(decodeEntities('&NotEqualTilde;')).toBe('\u2242\u0338');
    expect(decodeEntities('&#146;s &#150; &#x93;q&#x94;')).toBe('’s – “q”');
  });

  it('leaves a surrogate code point as written rather than make half a character', () => {
    expect(decodeEntities('&#xD800; &#55357;')).toBe('&#xD800; &#55357;');
  });
});

describe('parseHtml', () => {
  it('keeps elements, attributes in any quoting, and text', () => {
    const tree = parseHtml(`<div id="a" class='b c' data-x=plain hidden>Hi <b>there</b></div>`);
    const div = findFirst(tree, withTag('div'));
    expect(div?.attributes.get('id')).toBe('a');
    expect(div && classesOf(div)).toEqual(['b', 'c']);
    expect(div?.attributes.get('data-x')).toBe('plain');
    expect(div?.attributes.get('hidden')).toBe('');
    expect(div && textOf(div)).toBe('Hi there');
  });

  it('decodes entities in attributes and text, and keeps the first of a repeated attribute', () => {
    const tree = parseHtml('<a title="Q &amp; A" title="second">x &lt; y</a>');
    const link = findFirst(tree, withTag('a'));
    expect(link?.attributes.get('title')).toBe('Q & A');
    expect(link && textOf(link)).toBe('x < y');
  });

  it('reads tag and attribute names in any case as lower case', () => {
    const tree = parseHtml('<DIV ID="Up"><SPAN>x</SPAN></DIV>');
    expect(findFirst(tree, withId('Up'))?.tag).toBe('div');
    expect(findFirst(tree, withTag('span'))).not.toBeNull();
  });

  it('closes void and self-closed elements on their own, so what follows is their sibling', () => {
    const tree = parseHtml('<p><input value="1"><img src="x"/><span id="s">after</span></p>');
    const span = findFirst(tree, withId('s'));
    const input = findFirst(tree, withTag('input'));
    expect(input?.children).toEqual([]);
    expect(span && textOf(span)).toBe('after');
    expect(
      findFirst(tree, withTag('p'))
        ?.children.filter(isElement)
        .map((e) => e.tag),
    ).toEqual(['input', 'img', 'span']);
  });

  it('drops comments, doctypes, processing instructions, scripts and styles', () => {
    const tree = parseHtml(
      '<!doctype html><?xml version="1.0"?><!-- <div id="ghost"> --><script>if (a < b) { "<div id=\'ghost\'>" }</script><style>p{}</style><p>kept</p>',
    );
    expect(findFirst(tree, withId('ghost'))).toBeNull();
    expect(textOf(tree)).toBe('kept');
  });

  it('keeps the words of a title as text, and reads a raw-text element to the end when it is never closed', () => {
    expect(textOf(parseHtml('<title>A &amp; B</title>'))).toBe('A & B');
    expect(textOf(parseHtml('<p>x</p><script>never closed <div id="ghost">'))).toBe('x');
    expect(findFirst(parseHtml('<script>never closed <div id="g">'), withId('g'))).toBeNull();
  });

  it('reads an unterminated comment or declaration as running to the end', () => {
    expect(textOf(parseHtml('<p>x</p><!-- open'))).toBe('x');
    expect(textOf(parseHtml('<p>x</p><!doctype'))).toBe('x');
  });

  it('closes the nearest open element of an end tag’s name, and ignores a stray end tag', () => {
    const tree = parseHtml('<div id="outer"><span>a</div><p id="after">b</p></i>');
    const outer = findFirst(tree, withId('outer'));
    expect(outer && findFirst(outer, withId('after'))).toBeNull();
    expect(findFirst(tree, withId('after'))).not.toBeNull();
  });

  it('reads a < that starts no tag as text', () => {
    expect(textOf(parseHtml('<p>1 < 2 and 3 <= 4 </ and <3</p>'))).toBe(
      '1 < 2 and 3 <= 4 </ and <3',
    );
  });

  it('reads a page of tags that are never closed in time that grows with its size, not with its square', () => {
    const budgetMs = 250;
    const pages = [
      '<a '.repeat(20_000),
      '<a b="'.repeat(20_000),
      '</a '.repeat(20_000),
      `<a${' '.repeat(100_000)}"`,
      `<a b=${"'".repeat(1)}${'<a b="'.repeat(10_000)}`,
    ];
    for (const html of pages) {
      const started = performance.now();
      parseHtml(html);
      expect(performance.now() - started).toBeLessThan(budgetMs);
    }
  });

  it('reads the rest of a page as text once a tag is cut off, wherever it starts', () => {
    expect(textOf(parseHtml('<p>a</p> b </i and <b c="d'))).toBe('a b </i and <b c="d');
  });

  it('steps over junk inside a tag, and reads a tag cut off at the end as text', () => {
    const tree = parseHtml('<div / id="j" "odd">x</div>');
    expect(findFirst(tree, withId('j'))).not.toBeNull();
    expect(textOf(parseHtml('before <div id="cut'))).toBe('before <div id="cut');
  });
});

describe('queries', () => {
  const tree = parseHtml(
    '<div class="row a"><span class="x">1</span><div class="row b"><span class="x y">2</span></div></div>',
  );

  it('finds every match in document order, nested ones included', () => {
    expect(findAll(tree, withClass('row')).map((element) => classesOf(element)[1])).toEqual([
      'a',
      'b',
    ]);
  });

  it('matches only an element with every class asked for', () => {
    expect(findAll(tree, withClass('x', 'y')).map(textOf)).toEqual(['2']);
    expect(findFirst(tree, withClass('x', 'z'))).toBeNull();
  });

  it('finds the first match depth first', () => {
    const first = findFirst(tree, withClass('x'));
    expect(first && textOf(first)).toBe('1');
  });
});

describe('textOf', () => {
  it('reads <br> as a line break and collapses other white space, non-breaking included', () => {
    const tree = parseHtml('<p>  one\n  two&nbsp;&nbsp;three<br>four <br/>  <br><br>five </p>');
    expect(textOf(tree)).toBe('one two three\nfour\n\nfive');
  });
});

describe('depth', () => {
  it('says when a page nested deeper than a page may, so what is past the limit is not read as absent', () => {
    expect(parseHtmlDocument('<div>'.repeat(MAX_HTML_DEPTH + 1)).tooDeep).toBe(true);
    expect(parseHtmlDocument('<div>'.repeat(MAX_HTML_DEPTH - 1)).tooDeep).toBe(false);
    expect(parseHtmlDocument('<div><br><img><div></div></div>').tooDeep).toBe(false);
  });

  it('stops nesting past the most a page may nest, so a query cannot run out of stack', () => {
    const deep = '<div>'.repeat(100_000) + '<span id="end">x</span>';
    const tree = parseHtml(deep);
    expect(findFirst(tree, withId('end'))).not.toBeNull();
    let depth = 0;
    let element = tree;
    for (;;) {
      const child = element.children.find(isElement);
      if (child === undefined || child.tag !== 'div') break;
      element = child;
      depth += 1;
    }
    expect(depth).toBe(MAX_HTML_DEPTH);
  });
});
