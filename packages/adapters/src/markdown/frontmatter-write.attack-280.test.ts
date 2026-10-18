/**
 * Attack on #280 (#200): after updateFrontmatter, the reader must see the
 * change asked for, and the lines that were not touched keep their bytes
 * (ADR-0003). Each case here is a block where the writer and the reader
 * disagree about which pair a key names, or where an anchor the change
 * moves or removes is referred to from a key's position.
 */
import { describe, expect, it } from 'vitest';
import { updateFrontmatter } from './frontmatter-write.ts';
import { parseFrontmatterProperties } from './frontmatter.ts';

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;

/** The block's lines between the delimiters. */
const linesOf = (frontmatter: string) => frontmatter.split('\n').slice(1, -2);

describe('updateFrontmatter, on two spellings of one key, writes the pair the reader reads', () => {
  // The reader keeps the last of two pairs that name the same property; a
  // writer that edits the first leaves the property reading as it was.
  const nullAndEmpty = block('~: e', '"": z', 't: T');
  const numberAndString = block('1: a', '"1": b', 't: T');
  const aliasAndPlain = block('k: &k tasks', 'tasks: a', '*k : b');

  it('a null key and an empty-string key: setting "" is what the reader sees', () => {
    expect(parseFrontmatterProperties(nullAndEmpty)).toEqual({ '': 'z', t: 'T' });
    const written = updateFrontmatter(nullAndEmpty, { '': 'f' });
    expect(parseFrontmatterProperties(written)).toEqual({ '': 'f', t: 'T' });
    expect(linesOf(written)).toContain('t: T');
  });

  it('a null key and an empty-string key: removing "" leaves no "" for the reader', () => {
    const written = updateFrontmatter(nullAndEmpty, { '': null });
    expect(parseFrontmatterProperties(written)).toEqual({ t: 'T' });
    expect(linesOf(written)).toContain('t: T');
  });

  it('a number key and its quoted twin: setting "1" is what the reader sees', () => {
    expect(parseFrontmatterProperties(numberAndString)).toEqual({ '1': 'b', t: 'T' });
    const written = updateFrontmatter(numberAndString, { '1': 'c' });
    expect(parseFrontmatterProperties(written)).toEqual({ '1': 'c', t: 'T' });
    expect(linesOf(written)).toContain('t: T');
  });

  it('a number key and its quoted twin: removing "1" leaves no "1" for the reader', () => {
    const written = updateFrontmatter(numberAndString, { '1': null });
    expect(parseFrontmatterProperties(written)).toEqual({ t: 'T' });
  });

  it('a plain key and an alias key naming it: setting it is what the reader sees', () => {
    expect(parseFrontmatterProperties(aliasAndPlain)).toEqual({ k: 'tasks', tasks: 'b' });
    const written = updateFrontmatter(aliasAndPlain, { tasks: 'c' });
    expect(parseFrontmatterProperties(written)).toEqual({ k: 'tasks', tasks: 'c' });
    expect(linesOf(written)).toContain('k: &k tasks');
  });
});

describe('updateFrontmatter, on an anchor another key uses as its key', () => {
  const before = block('k: &k tasks', '*k : old', 'title: Plan');

  it('changing the anchored value does not rename the other key', () => {
    const written = updateFrontmatter(before, { k: 'other' });
    // Received: { k: 'other', other: 'old', title: 'Plan' } — the edit to `k`
    // silently renamed the property `tasks`.
    expect(parseFrontmatterProperties(written)).toEqual({
      k: 'other',
      tasks: 'old',
      title: 'Plan',
    });
    expect(linesOf(written)).toContain('title: Plan');
  });

  it('removing the anchored value does not throw, and the other key keeps its name', () => {
    // Received: throws "Unresolved alias (the anchor must be set before the alias): k".
    const written = updateFrontmatter(before, { k: null });
    expect(parseFrontmatterProperties(written)).toEqual({ tasks: 'old', title: 'Plan' });
    expect(linesOf(written)).toContain('title: Plan');
  });
});

describe('updateFrontmatter, on an anchor set on a key and used as a value', () => {
  const before = block('&k name: 1', 'other: *k', 't: T');

  it('the reader reads the alias as the key text', () => {
    expect(parseFrontmatterProperties(before)).toEqual({ name: 1, other: 'name', t: 'T' });
  });

  it('removing the anchored key does not throw, and the alias keeps its value', () => {
    // Received: throws "Unresolved alias (the anchor must be set before the alias): k".
    const written = updateFrontmatter(before, { name: null });
    expect(parseFrontmatterProperties(written)).toEqual({ other: 'name', t: 'T' });
    expect(linesOf(written)).toContain('t: T');
  });
});
