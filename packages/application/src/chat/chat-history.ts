import {
  appendChatEntries,
  CHATS_FOLDER,
  chatNoteName,
  isMarkdownFile,
  newChatNoteText,
  noteTitle,
  readChatNote,
  splitFrontmatter,
  VAULT_ROOT,
  type ChatNoteEntry,
  type ChatNoteMessage,
  type VaultPath,
} from '@atlas/domain';
import { createNoteFile } from '../notes/create-note.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { noteModified } from '../notes/note-modified.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** Where a chat is kept, once its first turn has been written. */
export interface ChatRecord {
  readonly path: VaultPath;
}

/** What a new chat note's header says. */
export interface ChatHeader {
  readonly created: string;
  readonly model: string;
  /** The title of the page the chat opened on, or null. */
  readonly context: string | null;
  /** The first thing asked, which names the note. */
  readonly firstMessage: string;
}

/** A past chat, as the list offers it. */
export interface ChatSummary {
  readonly path: VaultPath;
  readonly title: string;
  readonly modified: number;
}

/**
 * Writes a turn to the chat's note in `Chats/` (P27-02): a new note for the
 * first turn, and after that the turn appended to the note as it is on disk
 * now — so whatever the person changed in it is kept, byte for byte.
 */
export async function recordChatEntries({
  fs,
  record,
  header,
  entries,
  notePaths,
}: {
  fs: VaultFsPort;
  record: ChatRecord | null;
  header: ChatHeader;
  entries: readonly ChatNoteEntry[];
  notePaths: readonly VaultPath[];
}): Promise<ChatRecord> {
  if (record !== null && (await noteModified({ fs, path: record.path })) !== null) {
    await appendTo({ fs, path: record.path, entries });
    return record;
  }
  await ensureChatsFolder(fs);
  const path = await createNoteFile({
    fs,
    name: chatNoteName(header.firstMessage),
    beside: null,
    folder: CHATS_FOLDER,
    notePaths,
    contents: appendChatEntries(newChatNoteText(header), entries),
  });
  return { path };
}

async function appendTo({
  fs,
  path,
  entries,
}: {
  fs: VaultFsPort;
  path: VaultPath;
  entries: readonly ChatNoteEntry[];
}): Promise<void> {
  // Twice at most: once more if the note was saved between our read and write.
  for (let attempt = 1; ; attempt += 1) {
    const { text, modified } = await fs.readTextFile(path);
    try {
      await fs.writeTextFile({
        path,
        contents: appendChatEntries(text, entries),
        expectedModified: modified,
      });
      return;
    } catch (error) {
      if (!(error instanceof NoteChangedError) || attempt === 2) throw error;
    }
  }
}

async function ensureChatsFolder(fs: VaultFsPort): Promise<void> {
  const root = await fs.listDirectory(VAULT_ROOT);
  const exists = root.some((entry) => entry.kind === 'directory' && entry.path === CHATS_FOLDER);
  if (!exists) await fs.createFolder({ path: CHATS_FOLDER });
}

/** The chats kept in `Chats/`, most recent first. A vault with none has an empty list. */
export async function listChats({ fs }: { fs: VaultFsPort }): Promise<ChatSummary[]> {
  const root = await fs.listDirectory(VAULT_ROOT);
  if (!root.some((entry) => entry.kind === 'directory' && entry.path === CHATS_FOLDER)) return [];
  const entries = await fs.listDirectory(CHATS_FOLDER);
  return entries
    .filter(isMarkdownFile)
    .map((entry) => ({
      path: entry.path,
      title: noteTitle(entry.path),
      modified: entry.kind === 'file' ? (entry.modified ?? 0) : 0,
    }))
    .sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title));
}

/** A past chat's messages, read back from its note. */
export async function readChat({
  fs,
  path,
}: {
  fs: VaultFsPort;
  path: VaultPath;
}): Promise<ChatNoteMessage[]> {
  const { text } = await fs.readTextFile(path);
  return readChatNote(splitFrontmatter(text).body);
}
