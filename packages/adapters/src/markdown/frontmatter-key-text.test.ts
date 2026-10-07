/**
 * A frontmatter key read and written as the exact text it was found as
 * (A20-06): what archiving keeps of a note's own stamped keys, so that
 * unarchiving gives them back byte for byte rather than re-rendered.
 */
import { describe, expect, it } from 'vitest';
import { KeyAsWritten } from '@atlas/domain';
import { frontmatterKeyTexts, updateFrontmatter } from './frontmatter-write.ts';

describe('frontmatterKeyTexts', () => {
  it('is each top-level key’s own lines, comments above it included', () => {
    expect(
      frontmatterKeyTexts('---\ntitle: Plan\n# when\narchived: 0x1F\ntags:\n  - a\n---\n'),
    ).toEqual({
      title: 'title: Plan\n',
      archived: '# when\narchived: 0x1F\n',
      tags: 'tags:\n  - a\n',
    });
  });

  it('keeps an empty value as the bare key it was', () => {
    expect(frontmatterKeyTexts('---\narchived:\n---\n')).toEqual({ archived: 'archived:\n' });
  });

  it('reads a CRLF block with the line endings the rest of the writer uses', () => {
    expect(frontmatterKeyTexts('---\r\narchived: True\r\n---\r\n')).toEqual({
      archived: 'archived: True\n',
    });
  });

  it('is nothing for a note with no block', () => {
    expect(frontmatterKeyTexts(null)).toEqual({});
  });
});

describe('updateFrontmatter with a key given as written', () => {
  it('writes the key back exactly as given, where it stands', () => {
    const block = '---\ntitle: Plan\narchived: 2026-09-27\nstatus: open\n---\n';
    expect(
      updateFrontmatter(block, { archived: new KeyAsWritten('archived: [a,   b] # mine\n') }),
    ).toBe('---\ntitle: Plan\narchived: [a,   b] # mine\nstatus: open\n---\n');
  });

  it('adds it at the end when the block no longer has it', () => {
    expect(
      updateFrontmatter('---\ntitle: Plan\n---\n', { archived: new KeyAsWritten('archived:\n') }),
    ).toBe('---\ntitle: Plan\narchived:\n---\n');
  });

  it.each([
    ['another key', 'status: open\n'],
    ['two keys', 'archived: 1\nstatus: open\n'],
    ['a document marker', 'archived: |\n  x\n---\ny: 1\n'],
    ['text that is not YAML', 'archived: [unclosed\n'],
    ['an indented key', '  archived: 1\n'],
  ])('removes the key rather than write text holding %s', (_label, text) => {
    expect(
      updateFrontmatter('---\ntitle: Plan\narchived: 2026-09-27\n---\n', {
        archived: new KeyAsWritten(text),
      }),
    ).toBe('---\ntitle: Plan\n---\n');
  });
});
