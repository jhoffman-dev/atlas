import type { ProposalConfidence } from '../proposals/proposal.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** An open project tied to a person or company the meeting is linked to. */
export interface ProjectTie {
  readonly project: VaultPath;
  readonly title: string;
  /** The person or company it is tied to. */
  readonly entity: VaultPath;
}

export interface RankedProject {
  readonly project: VaultPath;
  readonly title: string;
  /** The meeting's people and companies tied to it, each once. */
  readonly entities: readonly VaultPath[];
}

/**
 * The open projects a meeting is likely about, most likely first: the more of
 * its people and companies a project is tied to, the likelier. Ties are broken
 * by title, then path, so the same vault always ranks the same way.
 */
export function rankProjects(ties: readonly ProjectTie[]): RankedProject[] {
  const byProject = new Map<VaultPath, { title: string; entities: Set<VaultPath> }>();
  for (const { project, title, entity } of ties) {
    const ranked = byProject.get(project) ?? { title, entities: new Set<VaultPath>() };
    ranked.entities.add(entity);
    byProject.set(project, ranked);
  }
  return [...byProject]
    .map(([project, { title, entities }]) => ({ project, title, entities: [...entities] }))
    .sort(byLikelihood);
}

/**
 * How sure a proposal of the first project can be: high when two or more of
 * the meeting's people and companies tie it and nothing ties as many to
 * another; medium when it leads on one; low when another ties as many. Null
 * when there is nothing to propose.
 */
export function projectConfidence(ranked: readonly RankedProject[]): ProposalConfidence | null {
  const [first, second] = ranked;
  if (first === undefined) return null;
  const lead = first.entities.length - (second?.entities.length ?? 0);
  if (lead <= 0) return 'low';
  return first.entities.length >= 2 ? 'high' : 'medium';
}

function byLikelihood(left: RankedProject, right: RankedProject): number {
  const more = right.entities.length - left.entities.length;
  if (more !== 0) return more;
  return (
    compareText(left.title.toLowerCase(), right.title.toLowerCase()) ||
    compareText(left.project, right.project)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
