export {
  DECISION_TYPE,
  isProposalNote,
  isProposalPath,
  PROPOSAL_CONFIDENCES,
  PROPOSAL_KINDS,
  PROPOSAL_NOTE_TYPES,
  PROPOSAL_STATES,
  PROPOSAL_TYPE,
  PROPOSALS_FOLDER,
  payloadRecord,
  proposalHeadline,
  proposedWriteRefusal,
  readProposal,
  readProposalPayload,
} from './proposal.ts';
export type {
  LinkPayload,
  NotePayload,
  NoteProposalKind,
  PayloadReading,
  ProposalConfidence,
  ProposalKind,
  ProposalNote,
  ProposalPayload,
  ProposalReading,
  ProposalState,
} from './proposal.ts';
export { applyProposal, newNotePath } from './apply-proposal.ts';
export type {
  LinkTarget,
  ProposalApplication,
  ProposalVault,
  ProposalWrite,
} from './apply-proposal.ts';
export { editedPayload, payloadFields, propertyFromText, propertyText } from './proposal-edit.ts';
export type { PayloadFields } from './proposal-edit.ts';
