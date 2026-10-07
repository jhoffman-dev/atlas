import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  changedSinceStranded,
  isStrandedEditExpired,
  parseStrandedEdit,
  redateStrandedEdit,
  STRANDED_EDIT_LIFETIME_MS,
  type StrandedEdit,
} from './stranded-edit.ts';

const KEPT_AT = 1_000_000;

const edit: StrandedEdit = {
  path: createVaultPath('Notes/today.md'),
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'b0' },
        content: [{ type: 'text', text: 'Typed.', marks: [{ type: 'strong' }] }],
      },
    ],
  },
  reason: 'the note changed on disk since it was opened',
  modified: 42,
  keptAt: KEPT_AT,
};

/** What storage hands back: the edit after a trip through JSON. */
const stored = (overrides: Record<string, unknown> = {}): unknown =>
  JSON.parse(JSON.stringify({ ...edit, ...overrides }));

describe('parseStrandedEdit', () => {
  it('reads back what was kept', () => {
    expect(parseStrandedEdit(stored())).toEqual(edit);
  });

  it('reads back work kept against a file that had gone', () => {
    expect(parseStrandedEdit(stored({ modified: null }))?.modified).toBeNull();
  });

  it.each([
    ['nothing', null],
    ['a string', 'Typed.'],
    ['an array', [edit]],
  ])('reads %s as nothing kept', (_label, value) => {
    expect(parseStrandedEdit(value)).toBeNull();
  });

  it.each([
    ['a path that escapes the vault', { path: '../secrets.md' }],
    ['an empty path', { path: '' }],
    ['a document that is not a doc', { doc: { type: 'paragraph', content: [] } }],
    ['a document without content', { doc: { type: 'doc' } }],
    ['a node without a type', { doc: { type: 'doc', content: [{ text: 'x' }] } }],
    ['a node whose text is not text', { doc: { type: 'doc', content: [{ type: 't', text: 1 }] } }],
    [
      'a node whose marks are not a list',
      { doc: { type: 'doc', content: [{ type: 't', marks: 1 }] } },
    ],
    [
      'a node whose attrs are a list',
      { doc: { type: 'doc', content: [{ type: 't', attrs: [] }] } },
    ],
    [
      'a nested node that is broken',
      { doc: { type: 'doc', content: [{ type: 'p', content: [7] }] } },
    ],
    ['a reason that is not text', { reason: 3 }],
    ['a modification time that is not a number', { modified: '42' }],
    ['a missing kept-at time', { keptAt: undefined }],
  ])('reads %s as nothing kept', (_label, overrides) => {
    expect(parseStrandedEdit(stored(overrides))).toBeNull();
  });
});

describe('parseStrandedEdit, on a mark that carries attributes', () => {
  const withMark = (mark: unknown) =>
    stored({
      doc: { type: 'doc', content: [{ type: 'text', text: 'Linked.', marks: [mark] }] },
    });

  it('accepts attributes that are a record', () => {
    expect(parseStrandedEdit(withMark({ type: 'link', attrs: { href: 'x' } }))).not.toBeNull();
  });

  it('reads attributes that are not a record as nothing kept', () => {
    expect(parseStrandedEdit(withMark({ type: 'link', attrs: 5 }))).toBeNull();
  });
});

describe('isStrandedEditExpired', () => {
  it('keeps work for its whole lifetime', () => {
    expect(isStrandedEditExpired({ edit, now: KEPT_AT + STRANDED_EDIT_LIFETIME_MS })).toBe(false);
  });

  it('lets it go once the lifetime has passed', () => {
    expect(isStrandedEditExpired({ edit, now: KEPT_AT + STRANDED_EDIT_LIFETIME_MS + 1 })).toBe(
      true,
    );
  });
});

describe('redateStrandedEdit, for work stamped after now', () => {
  // The clock went backwards after the work was kept. Left as it is, `now -
  // keptAt` stays negative and the work never expires until the clock
  // catches up; expired early instead, it would be lost for a wrong clock.
  const ahead = { ...edit, keptAt: KEPT_AT + STRANDED_EDIT_LIFETIME_MS * 10 };

  it('dates it now, so its whole lifetime starts when the clock is right', () => {
    const redated = redateStrandedEdit({ edit: ahead, now: KEPT_AT });

    expect(redated.keptAt).toBe(KEPT_AT);
    expect(
      isStrandedEditExpired({ edit: redated, now: KEPT_AT + STRANDED_EDIT_LIFETIME_MS + 1 }),
    ).toBe(true);
  });

  it('leaves work stamped in the past alone', () => {
    expect(redateStrandedEdit({ edit, now: KEPT_AT + 5 })).toBe(edit);
  });
});

describe('changedSinceStranded', () => {
  it('is unchanged when the file has the time it had when the work was kept', () => {
    expect(changedSinceStranded({ edit, modified: 42 })).toBe(false);
  });

  it('is changed when the file has been written since', () => {
    expect(changedSinceStranded({ edit, modified: 43 })).toBe(true);
  });

  it('is changed when the file had gone and is back', () => {
    expect(changedSinceStranded({ edit: { ...edit, modified: null }, modified: 42 })).toBe(true);
  });
});
