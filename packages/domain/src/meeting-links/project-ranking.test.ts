import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { projectConfidence, rankProjects, type ProjectTie } from './project-ranking.ts';

const p = (path: string) => createVaultPath(path);
const tie = (project: string, entity: string): ProjectTie => ({
  project: p(`Projects/${project}.md`),
  title: project,
  entity: p(entity),
});

describe('rankProjects', () => {
  it('ranks by how many of the meeting’s people and companies tie a project, each counted once', () => {
    const ranked = rankProjects([
      tie('Payrun', 'People/Mara.md'),
      tie('Payrun', 'People/Mara.md'),
      tie('Ledger', 'People/Mara.md'),
      tie('Ledger', 'Companies/Larkspur.md'),
    ]);
    expect(ranked.map(({ title, entities }) => [title, entities.length])).toEqual([
      ['Ledger', 2],
      ['Payrun', 1],
    ]);
  });

  it('breaks a tie by title, in any case, then by path', () => {
    const ranked = rankProjects([
      tie('zeta', 'People/Mara.md'),
      { ...tie('Alpha', 'People/Mara.md'), project: p('Work/Alpha.md') },
      tie('Alpha', 'People/Mara.md'),
      tie('beta', 'People/Mara.md'),
    ]);
    expect(ranked.map(({ project }) => project)).toEqual([
      'Projects/Alpha.md',
      'Work/Alpha.md',
      'Projects/beta.md',
      'Projects/zeta.md',
    ]);
  });
});

describe('projectConfidence', () => {
  const ranked = (...counts: number[]) =>
    rankProjects(
      counts.flatMap((count, at) =>
        Array.from({ length: count }, (_, entity) => tie(`P${at}`, `People/${entity}.md`)),
      ),
    );

  it('is high when two or more tie the first and it leads', () => {
    expect(projectConfidence(ranked(2, 1))).toBe('high');
    expect(projectConfidence(ranked(3))).toBe('high');
  });

  it('is medium when the first leads on one tie', () => {
    expect(projectConfidence(ranked(1))).toBe('medium');
  });

  it('is low when another ties as many, and null with nothing to propose', () => {
    expect(projectConfidence(ranked(2, 2))).toBe('low');
    expect(projectConfidence(ranked(1, 1))).toBe('low');
    expect(projectConfidence([])).toBeNull();
  });
});
