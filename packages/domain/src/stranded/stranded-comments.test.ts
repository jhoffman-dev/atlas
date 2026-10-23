import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { parseStrandedComments, type StrandedComments } from './stranded-comments.ts';

const kept: StrandedComments = {
  path: createVaultPath('Library/The Last Lamp.md'),
  comments: [{ id: 'k3x9q2', comment: 'Typed, then ⌘W.', base: 'Lit by Mara.' }],
  reason: 'The comment changed in the note meanwhile, so it was not written over.',
  keptAt: 1_000_000,
};

const stored = (overrides: Record<string, unknown> = {}): unknown =>
  JSON.parse(JSON.stringify({ ...kept, ...overrides }));

describe('comments a closing note could not write, read back (#534)', () => {
  it('reads back what was kept, with each comment’s base', () => {
    expect(parseStrandedComments(stored())).toEqual(kept);
  });

  it.each([
    ['not an object', 'text'],
    ['no path', stored({ path: '' })],
    ['no comments', stored({ comments: [] })],
    ['a comment with no id', stored({ comments: [{ id: '', comment: 'x', base: '' }] })],
    ['a comment with no base', stored({ comments: [{ id: 'a', comment: 'x' }] })],
    ['no reason', stored({ reason: 3 })],
    ['no date', stored({ keptAt: Number.NaN })],
  ])('reads %s as nothing kept', (_what, value) => {
    expect(parseStrandedComments(value)).toBeNull();
  });
});
