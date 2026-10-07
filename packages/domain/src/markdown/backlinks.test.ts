import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { backlinksFor, type NoteLink } from './backlinks.ts';

const path = createVaultPath;
const link = (source: string, target: string): NoteLink => ({ source: path(source), target });

const vault = [path('Today.md'), path('Notes/Other.md'), path('Third.md')];

describe('backlinksFor', () => {
  it('finds the note that links here', () => {
    expect(
      backlinksFor({
        links: [link('Notes/Other.md', 'Today')],
        notePaths: vault,
        note: path('Today.md'),
      }),
    ).toEqual(['Notes/Other.md']);
  });

  it('matches however the link was written', () => {
    const links = [link('Notes/Other.md', 'today'), link('Third.md', 'Today.md')];
    expect(backlinksFor({ links, notePaths: vault, note: path('Today.md') })).toEqual([
      'Notes/Other.md',
      'Third.md',
    ]);
  });

  it('counts a note once however many times it links here', () => {
    const links = [link('Third.md', 'Today'), link('Third.md', 'Today'), link('Third.md', 'today')];
    expect(backlinksFor({ links, notePaths: vault, note: path('Today.md') })).toEqual(['Third.md']);
  });

  it('ignores a note linking to itself', () => {
    expect(
      backlinksFor({
        links: [link('Today.md', 'Today')],
        notePaths: vault,
        note: path('Today.md'),
      }),
    ).toEqual([]);
  });

  it('ignores links pointing at other notes', () => {
    expect(
      backlinksFor({
        links: [link('Third.md', 'Other')],
        notePaths: vault,
        note: path('Today.md'),
      }),
    ).toEqual([]);
  });

  it('ignores a link that resolves to nothing', () => {
    expect(
      backlinksFor({
        links: [link('Third.md', 'Missing')],
        notePaths: vault,
        note: path('Today.md'),
      }),
    ).toEqual([]);
  });

  it('returns sources in a stable order', () => {
    const links = [link('Third.md', 'Today'), link('Notes/Other.md', 'Today')];
    expect(backlinksFor({ links, notePaths: vault, note: path('Today.md') })).toEqual([
      'Notes/Other.md',
      'Third.md',
    ]);
  });

  it('returns nothing when there are no links at all', () => {
    expect(backlinksFor({ links: [], notePaths: vault, note: path('Today.md') })).toEqual([]);
  });
});
