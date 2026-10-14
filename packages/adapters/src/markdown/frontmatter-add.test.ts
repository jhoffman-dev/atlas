/**
 * Adding keys to a frontmatter map as lines only (#162): every line the block
 * had is kept byte for byte, and a block that cannot be added to that way is
 * refused rather than rewritten.
 */
import { describe, expect, it } from 'vitest';
import { addToFrontmatterMap } from './frontmatter-add.ts';
import { parseFrontmatterProperties } from './frontmatter.ts';

const TASKS = { tasks: { kind: 'relation', target: 'task', many: true } };

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;

/** `before` with `lines` put in after its first `kept` lines, the opening `---` among them. */
const withLines = (before: string, kept: number, ...lines: string[]) => {
  const all = before.split('\n');
  return [...all.slice(0, kept), ...lines, ...all.slice(kept)].join('\n');
};

describe('addToFrontmatterMap', () => {
  it('puts the new keys after the last, at a 4-space indent, keeping comments and folded text', () => {
    const before = block(
      'name: meeting',
      'properties: # Mara’s own',
      '    title:',
      '        kind: text # what it was',
      '        label: >-',
      '            What the',
      '            call was',
      '    when: date   # the day',
      'label: Meeting',
    );
    expect(addToFrontmatterMap(before, 'properties', TASKS)).toBe(
      withLines(
        before,
        9,
        '    tasks:',
        '        kind: relation',
        '        target: task',
        '        many: true',
      ),
    );
  });

  it('adds after a last property whose value is a folded scalar running to the end of the block', () => {
    const before = block(
      'name: meeting',
      'properties:',
      '  title:',
      '    label: >',
      '      What the',
      '      call was',
    );
    const written = addToFrontmatterMap(before, 'properties', { when: 'date' });
    expect(written).toBe(withLines(before, 7, '  when: date'));
    expect(parseFrontmatterProperties(written)['properties']).toEqual({
      title: { label: 'What the call was\n' },
      when: 'date',
    });
  });

  it('keeps a comment that follows the map where it was, after the lines added', () => {
    const before = block('properties:', '  title: text', '# kept here', 'name: meeting');
    expect(addToFrontmatterMap(before, 'properties', { when: 'date' })).toBe(
      withLines(before, 3, '  when: date'),
    );
  });

  it('keeps CRLF line endings, and writes the new lines with them', () => {
    const before = block('name: meeting', 'properties:', '  title: text').replace(/\n/g, '\r\n');
    expect(addToFrontmatterMap(before, 'properties', { when: 'date' })).toBe(
      '---\r\nname: meeting\r\nproperties:\r\n  title: text\r\n  when: date\r\n---\r\n',
    );
  });

  it('starts the map in a block with none, adding only lines', () => {
    const before = block('name: meeting', 'label: Meeting');
    expect(addToFrontmatterMap(before, 'properties', { when: 'date' })).toBe(
      withLines(before, 3, 'properties:', '  when: date'),
    );
  });

  it('fills a `properties:` that holds nothing, keeping its line', () => {
    const before = block('name: meeting', 'properties:', 'label: Meeting');
    expect(addToFrontmatterMap(before, 'properties', { when: 'date' })).toBe(
      withLines(before, 3, '  when: date'),
    );
  });

  it.each([
    ['a list', block('name: daily', 'properties:', '  - title', '  - when')],
    ['a sentence', block('name: daily', 'properties: see the Daily note')],
    ['an inline map', block('name: daily', 'properties: {title: text}')],
    ['an empty inline map', block('name: daily', 'properties: {}')],
    ['a key it would add', block('name: daily', 'properties:', '  when: text')],
    ['YAML it cannot read', block('name: daily', 'properties:', '  title: [text')],
  ])('refuses `properties` that is %s, rather than change a line', (_, before) => {
    expect(addToFrontmatterMap(before, 'properties', { when: 'date' })).toBeNull();
  });
});
