import { describe, expect, it } from 'vitest';
import { parseStrandedEdit } from './stranded-edit.ts';

/**
 * Adversarial: `parseStrandedEdit` promises that anything "not recognisably the
 * shape that is written reads as nothing, rather than handing a broken document
 * to the editor". It checks that `marks` is a list, but not what is in it — and
 * `EditorMark` is typed `{ type: string }`, so a stored `[null]` reaches
 * `editor-to-mdast`'s `markKey(mark)` as `null.type`.
 */

const storedWithMarks = (marks: unknown): unknown => ({
  path: 'Notes/today.md',
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Typed.', marks }] }],
  },
  reason: 'the note changed on disk since it was opened',
  modified: 42,
  keptAt: 1_000_000,
});

describe('parseStrandedEdit, on the marks inside a list', () => {
  it('accepts a well-formed mark (control)', () => {
    expect(parseStrandedEdit(storedWithMarks([{ type: 'bold' }]))).not.toBeNull();
  });

  it.each([
    ['a null mark', [null]],
    ['a mark that is a number', [7]],
    ['a mark without a type', [{}]],
    ['a mark whose type is not text', [{ type: 3 }]],
  ])('reads %s as nothing kept', (_label, marks) => {
    expect(parseStrandedEdit(storedWithMarks(marks))).toBeNull();
  });
});
