/**
 * Where a Claude step may put a note (P29-03): the proposals' rule, and the
 * limits the chat's own proposals and the vault's walk already hold. One
 * place, asked of a rule's `folder:` when it is read, of a proposal's folder
 * when an answer is read, and of the action again when a run starts.
 */

import { isInChats } from '../chat/chat-note.ts';
import { proposedWriteRefusal } from '../proposals/proposal.ts';
import { MAX_NAME_BYTES, utf8Bytes } from '../vault/file-name-bytes.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { isWithinWalk } from '../vault/vault-visibility.ts';

/** Why a Claude step may not write a note in `folder`, or null when it may. */
export function claudeWriteRefusal(folder: string): string | null {
  const shown = JSON.stringify(folder);
  if (isInChats(folder)) {
    return `${shown} is the record of past chats; a Claude step does not write there.`;
  }
  if (folder.split('/').some((segment) => utf8Bytes(segment) > MAX_NAME_BYTES)) {
    return `${shown} has a folder name longer than a disk takes.`;
  }
  // A note is one level further down than its folder.
  if (!isWithinWalk(`${folder}/note.md`)) {
    return `${shown} is deeper than the vault is read, where its note would never show.`;
  }
  return (
    proposedWriteRefusal(createVaultPath(folder))?.replace('a proposal', 'a Claude step') ?? null
  );
}
