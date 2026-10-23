import {
  checkSpec,
  specProposalFor,
  type SpecProblem,
  type SpecProposalKind,
  type VaultPath,
} from '@dfai/domain';
import { loadObjectTypes } from '../types/load-types.ts';
import {
  writeProposals,
  type ProposalLeft,
  type ProposalWritePorts,
} from '../proposals/write-proposals.ts';

/** A spec refused by its checker, with every problem it found, in the checker's words. */
export class SpecRefusedError extends Error {
  constructor(readonly problems: readonly SpecProblem[]) {
    super(problems.map(({ at, message }) => `${at}: ${message}`).join(' '));
    this.name = 'SpecRefusedError';
  }
}

/** What asking for a dashboard or a view came to. */
export interface ProposedSpec {
  readonly kind: SpecProposalKind;
  /** What it would be called: its name, as the proposal's title. */
  readonly title: string;
  /** The proposal written; null when the same one was proposed before, open or answered. */
  readonly proposal: VaultPath | null;
  /** A proposal that could not be written, and why; null when none. */
  readonly left: ProposalLeft | null;
}

/**
 * Checks a dashboard or view spec (P32-05) and leaves it in the Inbox as a
 * proposal — never in `.atlas`, which only the app's Accept writes
 * (ADR-0016). A spec its checker refuses is `SpecRefusedError`, with
 * nothing written. The same spec asked for again is proposed once.
 */
export async function proposeSpec({
  ports,
  spec,
  madeBy,
}: {
  ports: ProposalWritePorts;
  spec: unknown;
  /** Who asked, as the proposal's `made_by` says it. */
  madeBy: string;
}): Promise<ProposedSpec> {
  const types = await loadObjectTypes({ fs: ports.fs, markdown: ports.markdown });
  const reading = checkSpec(spec, { types });
  if (!reading.ok) throw new SpecRefusedError(reading.problems);
  const { checked } = reading;
  const written = await writeProposals({
    ...ports,
    proposals: [specProposalFor({ checked, madeBy })],
  });
  return {
    kind: checked.kind,
    title: checked.payload.title,
    proposal: written.written[0] ?? null,
    left: written.left[0] ?? null,
  };
}
