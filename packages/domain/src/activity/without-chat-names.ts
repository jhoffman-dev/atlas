/*
 * A chat note is named by the first words of the question that started it, so
 * its name is the question. The Activity log keeps a line for a month, so a
 * line never names one: neither by a path in its words, which may come from an
 * error, nor by the title a report gives the note it is about.
 */

import { CHAT_NOTE_LABEL } from '../chat/chat-note.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/*
 * `Chats/` as a path's folder — bare, quoted, or under another folder — with
 * a name after it. A name may start with any character, a quote or a bracket
 * among them; only a closer with a space or the end after it ends the path
 * there (`saved to Chats/.`). A path runs to the last `.md` on its line, since
 * a name can hold spaces and dots; one without `.md` runs to the line's end.
 * Stripping too much is safe; too little leaks the question.
 */
const CHAT_PATH =
  /(?<![\p{L}\p{N}_.-])chats\/(?!\s|$|[,.;:!?)\]}>"'`’”»](?:\s|$))(?:[^\n]*\.md(?![\p{L}\p{N}])|[^\n]*)/gimu;

/** The message with every chat note's path in it said as "a chat note". */
export function withoutChatPaths(message: string): string {
  return message.replace(CHAT_PATH, CHAT_NOTE_LABEL);
}

/** The message with the chat note's title — the question's first words — said as "a chat note". */
export function withoutChatTitle(message: string, chatPath: VaultPath): string {
  const title = noteTitle(chatPath);
  return title === '' ? message : message.split(title).join(CHAT_NOTE_LABEL);
}
