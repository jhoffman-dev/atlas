import { describe, expect, it } from 'vitest';
import type { WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import { DroppedContent } from './export-drops.ts';
import { escapedForMarkdown, rawMarkdownForExport } from './raw-markdown.ts';

const wordsOf = (link: WikiLinkOrEmbed) => link.alias ?? link.target.toUpperCase();

const exported = (markdown: string) => {
  const dropped = new DroppedContent();
  return {
    markdown: rawMarkdownForExport(markdown, { wordsOf, dropped }),
    dropped: dropped.list(),
  };
};

describe('raw markdown, exported', () => {
  it('has each link as its words, escaped so they read as words', () => {
    expect(exported('See [[a_b]] and ![[c|*d*]].[^1]')).toEqual({
      markdown: 'See A\\_B and \\*d\\*.[^1]',
      dropped: [
        { kind: 'link', items: ['[[a_b]]'] },
        { kind: 'embed', items: ['![[c|*d*]]'] },
      ],
    });
  });

  it('leaves a link in code alone', () => {
    const markdown = '> `[[x]]` [^1]\n>\n> ```\n> [[y]] ^b1\n> ```';
    expect(exported(markdown)).toEqual({ markdown, dropped: [] });
  });

  it('leaves out each comment, and lists it', () => {
    expect(exported('<!-- to do: ask -->\nText <b>x</b> <!-- b -->')).toEqual({
      markdown: '\nText <b>x</b> ',
      dropped: [{ kind: 'comment', items: ['<!-- to do: ask -->', '<!-- b -->'] }],
    });
  });

  it('leaves out the id ending a line, but not one in code', () => {
    const markdown = '- One <b>x</b> ^a1\n- Two ^b2  \r\n\n```\nkeep ^c3\n```\n';
    expect(exported(markdown)).toEqual({
      markdown: '- One <b>x</b>\n- Two  \r\n\n```\nkeep ^c3\n```\n',
      dropped: [{ kind: 'block-id', items: ['a1', 'b2'] }],
    });
  });

  it('opens a callout with its name in bold, then its title', () => {
    expect(exported('> [!warning] Mind [[the gap]]\n> Body.[^1]').markdown).toBe(
      '> **Warning:** Mind THE GAP\n> Body.[^1]',
    );
    expect(exported('> [!tip]\n> Body.[^1]').markdown).toBe('> **Tip**\n> Body.[^1]');
  });

  it('lists a callout fold', () => {
    expect(exported('> [!faq]- Why?\r\n> Because.[^1]')).toEqual({
      markdown: '> **Faq:** Why?\r\n> Because.[^1]',
      dropped: [{ kind: 'callout-fold', items: ['[!faq]- Why?'] }],
    });
  });

  it('reads a marker only where it opens the block', () => {
    const markdown = '> Text.\n> [!note] not a callout';
    expect(exported(markdown).markdown).toBe(markdown);
  });
});

describe('escapedForMarkdown', () => {
  it("escapes markdown's punctuation and leaves letters, digits and spaces", () => {
    expect(escapedForMarkdown('a*b_c [d] <e> |f| `g` ~h~ &i #j !k \\ 1. Z')).toBe(
      'a\\*b\\_c \\[d\\] \\<e\\> \\|f\\| \\`g\\` \\~h\\~ \\&i \\#j \\!k \\\\ 1. Z',
    );
  });
});
