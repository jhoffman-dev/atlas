import { ANSWERED_VIA_KEY, type ProposalAnswerer, type VaultPath } from '@atlas/domain';
import {
  archiveProposal,
  readOpenProposal,
  refuseUnsaved,
  stampProposal,
  type ProposalArchived,
  type ProposalPorts,
} from './proposal-file.ts';

/**
 * Rejects the proposal at `path`: writes nothing it proposed, marks it
 * `state: rejected` and files it in the Archive, where it is kept rather than
 * deleted (P29-02).
 */
export async function rejectProposalNote({
  ports,
  path,
  today,
  via = 'app',
}: {
  ports: ProposalPorts;
  path: VaultPath;
  today: string;
  /** Who answered, recorded on the proposal as `answered_via`: the app's buttons unless said otherwise. */
  via?: ProposalAnswerer;
}): Promise<ProposalArchived> {
  const file = await readOpenProposal(ports, path);
  refuseUnsaved(ports.editors, path);
  await stampProposal(
    ports,
    { ...file, path },
    {
      state: 'rejected',
      [ANSWERED_VIA_KEY]: via,
    },
  );
  return archiveProposal({ ports, path, today });
}
