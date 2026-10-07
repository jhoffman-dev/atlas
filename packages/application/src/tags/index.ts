export { loadTagCounts, loadTagCountsWhere, loadTaggedNotes } from './load-tags.ts';
export type { TaggedNote } from './load-tags.ts';
export { renameTag, renameTagInNote, TagRenameError, tagRenamePlan } from './rename-tag.ts';
export type { TagRenamePlan, TagRenameReport } from './rename-tag.ts';
export { createTagRenames, TagMergeError } from './tag-renames.ts';
export type { TagRenames, VaultTagRenames } from './tag-renames.ts';
