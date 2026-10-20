export { createPerson, loadPeople } from './people.ts';
export type { CreatedPerson } from './people.ts';
export {
  applyPeopleMerge,
  PeopleMergeChangedError,
  PeopleMergeRefusedError,
  peopleMergeSummary,
  previewPeopleMerge,
} from './merge-people.ts';
export type {
  MergeFailure,
  MergePanes,
  MergePorts,
  PeopleMergePreview,
  PeopleMergeReport,
  PeopleMergeRequest,
  PlannedWrite,
} from './merge-people.ts';
export { dismissPossibleDuplicate, loadPossibleDuplicates } from './possible-duplicates.ts';
export type { DuplicatesPorts } from './possible-duplicates.ts';
