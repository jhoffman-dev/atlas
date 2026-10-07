export { inVault, noVaultOpen } from './in-vault.ts';
export { openVault, restoreVault } from './open-vault.ts';
export { listVaultDirectory, listVaultNotes, readVaultFile } from './read-vault.ts';
export { VaultAccessError } from './ports.ts';
export { createFolder, ensureFolder, listVaultFolders } from './create-folder.ts';
export { guardTemplateEdit, TemplateEditRefusedError } from './template-guard.ts';
export { moveEntryInto, moveEntryTo, renameEntry, MoveRefusedError } from './relocate-entry.ts';
export type { Relocation, RelocationPorts } from './relocate-entry.ts';
export { countOtherFiles, deleteEntry, previewDeletion } from './delete-entry.ts';
export { linksToUpdate, updateLinks, UnsavedTypingError } from './update-links.ts';
export type {
  LinkUpdate,
  LinkUpdateFailure,
  LinkUpdatePanes,
  LinkUpdateReport,
} from './update-links.ts';
export type { DeletionPreview } from './delete-entry.ts';
export type {
  HostVaultFsPort,
  OpenEditorsPort,
  NoteContents,
  NoteFile,
  NoteListing,
  VaultFsPort,
  VaultLocation,
  VaultLocationStore,
  VaultPickerPort,
  VaultWatchPort,
} from './ports.ts';
