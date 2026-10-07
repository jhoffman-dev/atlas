import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { noteLinks, noteLinksLabel, NO_LINKS } from './note-links.ts';
import { buildVaultGraph } from './vault-graph.ts';

const graph = buildVaultGraph({
  notes: [
    { path: 'plan.md', title: 'The plan', type: null },
    { path: 'task.md', title: 'A task', type: 'task' },
    { path: 'zed.md', title: 'Zed', type: null },
  ],
  links: [
    { source: 'task.md', target: 'plan.md' },
    { source: 'plan.md', target: 'zed.md' },
  ],
  relations: [{ source: 'task.md', key: 'project', value: '[[plan]]' }],
});

describe('noteLinks', () => {
  const plan = noteLinks(graph, createVaultPath('plan.md'));

  it('lists what points here, plain links before relations, each by its title', () => {
    expect(plan.incoming).toEqual([
      { path: 'task.md', title: 'A task', via: null },
      { path: 'task.md', title: 'A task', via: 'Project' },
    ]);
  });

  it('lists what this note points at', () => {
    expect(plan.outgoing).toEqual([{ path: 'zed.md', title: 'Zed', via: null }]);
  });

  it('is nothing for a note nothing touches', () => {
    expect(noteLinks(graph, createVaultPath('other.md'))).toEqual(NO_LINKS);
  });
});

describe('linked mentions from the Archive (A20-05)', () => {
  const withArchive = buildVaultGraph({
    notes: [
      { path: 'plan.md', title: 'The plan', type: null },
      { path: 'live.md', title: 'Live', type: null },
      { path: 'Archive/old.md', title: 'Old', type: null },
    ],
    links: [
      { source: 'live.md', target: 'plan.md' },
      { source: 'Archive/old.md', target: 'plan.md' },
      { source: 'plan.md', target: 'Archive/old.md' },
    ],
    relations: [],
  });
  const plan = createVaultPath('plan.md');

  it('leaves out a note in the Archive that links here, unless asked', () => {
    expect(noteLinks(withArchive, plan).incoming.map((entry) => entry.path)).toEqual(['live.md']);
    expect(
      noteLinks(withArchive, plan, { includeArchived: true }).incoming.map((entry) => entry.path),
    ).toEqual(['live.md', 'Archive/old.md']);
  });

  it('still lists an archived note this one links to, since the link is this note’s own', () => {
    expect(noteLinks(withArchive, plan).outgoing.map((entry) => entry.path)).toEqual([
      'Archive/old.md',
    ]);
  });
});

describe('noteLinksLabel', () => {
  it('counts both ways', () => {
    expect(noteLinksLabel(noteLinks(graph, createVaultPath('plan.md')))).toBe(
      '2 linked here · 1 linked from here',
    );
  });

  it('says so when there are none', () => {
    expect(noteLinksLabel(NO_LINKS)).toBe('No links yet');
  });
});
