import { describe, expect, it } from 'vitest';
import { highlightMarker, readHighlights } from '@dfai/domain';
import { noteBlocks } from './note-blocks.ts';

/*
 * Which block quotes of a note are highlights, as the markdown parser reads
 * the note (ADR-0043 §2): code, HTML, list items, lazy lines and Obsidian
 * `%%` comments, read by the parser that renders it. Moved from the domain's
 * tests when the parser took over finding the blocks.
 */

const MARKER = highlightMarker({
  style: { mark: 'highlight', color: 'yellow' },
  anchor: { kind: 'kindle', location: { start: 41, end: 44 }, annotationId: null },
});

describe('which block quotes the parser finds (ADR-0043 §2)', () => {
  it.each([
    ['a quote in a list', `- > Quote.\n  > ${MARKER}\n\n^abc123\n`],
    ['a quote in a code fence', `\`\`\`\n> Quote.\n> ${MARKER}\n\n^abc123\n\`\`\`\n`],
    ['a quote in a tilde fence', `~~~md\n> Quote.\n> ${MARKER}\n\n^abc123\n~~~\n`],
  ])('reads no highlight from %s', (_label, text) => {
    expect(readHighlights(text, noteBlocks)).toEqual([]);
  });

  // CommonMark: a block quote interrupts a paragraph, and its `>` may be up to three
  // spaces in. Obsidian shows both as a quote; the line rules before the parser did not.
  it.each([
    ['no blank line before the quote', `Words.\n> Quote.\n> ${MARKER}\n\n^abc123\n`],
    ['an indented quote', `  > Quote.\n  > ${MARKER}\n\n^abc123\n`],
  ])('reads a highlight from %s, as Obsidian shows it', (_label, text) => {
    expect(readHighlights(text, noteBlocks).map((block) => [block.id, block.quote])).toEqual([
      ['abc123', 'Quote.'],
    ]);
  });

  it('reads a highlight again once a fence has closed, and not until then', () => {
    const block = `> Quote.\n> ${MARKER}\n\n^abc123\n`;
    expect(
      readHighlights(`\`\`\`\`\n\`\`\`\n\n${block}\`\`\`\`\n\n${block}`, noteBlocks),
    ).toHaveLength(1);
    expect(readHighlights(`~~~\n\`\`\`\n~~~\n\n${block}`, noteBlocks)).toHaveLength(1);
  });
});

describe('what hides a highlight (ADR-0043, R1)', () => {
  const BLOCK = `> Quote.\n> ${MARKER}\n\n^abc123\n`;
  const ids = (text: string) => readHighlights(text, noteBlocks).map((block) => block.id);

  it.each([
    ['a <pre> block', '<pre>\n', '</pre>\n'],
    ['a <script> block, whatever its case', '<SCRIPT type="module">\n', 'x();</Script>\n'],
    ['a <style> block', '<style>\n', '</style>\n'],
    ['a <textarea> block', '<textarea>\n', '</textarea>\n'],
    ['an HTML comment', '<!--\n', '-->\n'],
    ['an Obsidian %% comment', '%%\n', '%%\n'],
    ['an Obsidian %% comment opened mid-line', 'A thought %% hidden\n', 'still %% shown\n'],
  ])('reads nothing inside %s, and reads on once it closes', (_label, open, close) => {
    expect(ids(`${open}\n${BLOCK}${close}\n${BLOCK}`)).toEqual(['abc123']);
    expect(ids(`${open}\n${BLOCK}`)).toEqual([]);
  });

  it.each([
    ['a %% comment closed on its own line', 'Words %%aside%% more.\n\n'],
    ['%% in inline code', 'Type `%%` to comment.\n\n'],
    ['%% inside an HTML comment', '<!-- 50%% -->\n\n'],
    ['<pre> closed on its own line', '<pre>kept</pre>\n\n'],
    ['a <b> line, which is no raw HTML block', '<b>bold</b>\n\n'],
  ])('reads a highlight after %s', (_label, before) => {
    expect(ids(before + BLOCK)).toEqual(['abc123']);
  });

  it('is not hidden by %% in the words of a highlight marker before it', () => {
    const marker = highlightMarker({
      style: { mark: 'highlight', color: 'yellow' },
      anchor: {
        kind: 'kindle',
        location: { start: 1, end: null },
        annotationId: null,
        exact: '50%% off',
      },
    });
    const first = `> Fifty off.\n> ${marker}\n\n^first1\n\n`;
    expect(ids(first + BLOCK)).toEqual(['first1', 'abc123']);
  });

  it('is hidden after a highlight whose comment opens a %% comment', () => {
    const first = `> Words.\n> ${MARKER}\n>\n> A thought %% to hide\n\n^first1\n\n`;
    expect(ids(first + BLOCK)).toEqual(['first1']);
  });

  it.each([
    ['a fence in a list item', '- Step one\n  ```sh\n  make draft\n'],
    ['a fence on the list item line', '- ```sh\n  make draft\n'],
    ['a fence in an ordered item indented past three spaces', '10. Step\n    ```\n    code\n'],
    ['a fence in a nested item', '- Outer\n  - Inner\n    ```\n    code\n'],
    ['an HTML comment in a list item', '- Step one\n  <!--\n  hidden\n'],
    ['a fence in an item, past a blank line in it', '- Step\n\n  ```\n\n  code\n'],
  ])('ends %s when the item ends, as CommonMark has it', (_label, list) => {
    expect(ids(`${list}\n${BLOCK}`)).toEqual(['abc123']);
  });

  it.each([
    ['on the list item line', '- ```\n  %%\n  ```\n'],
    ['in an ordered item indented past three spaces', '10. Step\n    ```\n    %%\n    ```\n'],
  ])('takes a fence %s as a fence, whose %% opens nothing', (_label, list) => {
    expect(ids(`${list}\n${BLOCK}`)).toEqual(['abc123']);
  });

  it.each([
    ['a thematic break, which is no list item', '- - -\n  ```\n'],
    ['a paragraph, which is no list item', 'Words.\n  ```\n'],
  ])('keeps a fence open to the end after %s', (_label, before) => {
    expect(ids(`${before}\n${BLOCK}`)).toEqual([]);
  });

  it('takes a fence indented four spaces at the top as indented code, which hides nothing after it', () => {
    expect(ids(`    \`\`\`\n\n${BLOCK}`)).toEqual(['abc123']);
  });

  it('does not take a backtick fence whose info string holds a backtick as a fence', () => {
    expect(ids(`\`\`\`js\` x\n\n${BLOCK}`)).toEqual(['abc123']);
  });
});

describe('a line without its `>` in a highlight (ADR-0043, R2)', () => {
  const block = (lazy: string) => `> Quote.\n> ${MARKER}\n>\n> A comment,\n${lazy}\n\n^abc123\n`;
  const ids = (text: string) => readHighlights(text, noteBlocks).map((found) => found.id);

  it.each([
    ['a setext underline of =, which cannot be lazy', '==='],
    ['a setext underline of two dashes', '--'],
    ['a heading mark with no space', '#tag'],
    ['seven #', '####### no heading'],
    ['two backticks', '`` code ``'],
    ['two tildes', '~~struck~~'],
    ['a backtick fence with a backtick after it', '```a`'],
    ['inline HTML', '<span>x</span>'],
    ['a closing tag of an inline element', '</em> after'],
    ['an autolink', '<https://example.org>'],
    ['a thematic break of mixed marks', '-*-'],
  ])('keeps the comment going through %s', (_label, lazy) => {
    expect(ids(block(lazy))).toEqual(['abc123']);
  });

  it.each([
    ['a heading', '# Heading'],
    ['a heading of six #', '###### Heading'],
    ['a heading with nothing after it', '#'],
    ['a thematic break', '---'],
    ['a thematic break of spaced stars', '* * *'],
    ['a backtick fence', '```js'],
    ['a tilde fence', '~~~'],
    ['a bullet item', '- item'],
    // A list item cannot interrupt a paragraph, but a line outside the quote is not in its
    // paragraph to interrupt: CommonMark (micromark here) starts the list there.
    ['a lone dash, an empty item', '-'],
    ['an empty ordered item', '1.'],
    ['an ordered item not numbered 1', '2. more'],
    ['an ordered item numbered 1', '1) item'],
    ['an HTML comment', '<!-- x -->'],
    ['a <div>', '<div class="x">'],
    ['a <pre>', '<pre>'],
    ['a processing instruction', '<?php'],
    ['a declaration', '<!DOCTYPE html>'],
    ['CDATA', '<![CDATA[x]]>'],
  ])('ends the comment at %s, so the block is no highlight', (_label, lazy) => {
    expect(ids(block(lazy))).toEqual([]);
  });

  it('tells a lazy line from a block start in a note saved on Windows', () => {
    expect(ids(block('===').replace(/\n/g, '\r\n'))).toEqual(['abc123']);
    expect(ids(block('---').replace(/\n/g, '\r\n'))).toEqual([]);
    expect(ids(block('#').replace(/\n/g, '\r\n'))).toEqual([]);
  });
});
