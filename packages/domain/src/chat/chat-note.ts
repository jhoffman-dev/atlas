import { cleanEntryName } from '../vault/new-note.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';

/**
 * A conversation kept as a note in `Chats/` (ADR-0021): the person's, like any
 * other note. It is written once as a header, then only ever appended to, so
 * whatever the person changes in an old chat is never written over.
 */

export const CHATS_FOLDER: VaultPath = createVaultPath('Chats');
export const CHAT_TYPE = 'chat';

const YOU = '## You';
const CLAUDE = '## Claude';
/** How many words of the first message name the chat. */
const NAME_WORDS = 6;

/** One turn as the chat note records it. */
export type ChatNoteEntry =
  | { readonly role: 'user'; readonly text: string }
  | {
      readonly role: 'assistant';
      readonly text: string;
      /** What the model did along the way — a search, a proposed edit — one line each. */
      readonly activity: readonly string[];
    };

/** A chat read back from its note, for reopening. */
export interface ChatNoteMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/**
 * Whether the path is in `Chats/`, whose notes are named by the first words of
 * what was asked. Compared without case: on a case-insensitive disk `chats/`
 * is the same folder.
 */
export function isInChats(path: string): boolean {
  return path.split('/')[0]?.toLowerCase() === CHATS_FOLDER.toLowerCase();
}

/** What a new chat is called: the first words of what was asked. */
export function chatNoteName(firstMessage: string): string {
  const words = cleanEntryName(firstMessage.replace(/[#[\]]/g, ' ')).split(' ');
  const name = words.slice(0, NAME_WORDS).join(' ');
  return name === '' ? 'Chat' : name;
}

/** The text a chat note starts as: its properties, and nothing said yet. */
export function newChatNoteText({
  created,
  model,
  context,
}: {
  /** When the chat began, as the person's clock writes it. */
  created: string;
  model: string;
  /** The title of the page the chat was opened on, or null. */
  context: string | null;
}): string {
  const lines = ['---', `type: ${CHAT_TYPE}`, `created: ${JSON.stringify(created)}`];
  lines.push(`model: ${JSON.stringify(model)}`);
  if (context !== null) lines.push(`context: ${JSON.stringify(`[[${context}]]`)}`);
  lines.push('---', '');
  return `${lines.join('\n')}\n`;
}

/** `existing` with these entries added at the end, and not one byte before them changed. */
export function appendChatEntries(existing: string, entries: readonly ChatNoteEntry[]): string {
  const added = entries.map(entryText).join('\n');
  if (existing === '') return added;
  const gap = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${gap}${added}`;
}

function entryText(entry: ChatNoteEntry): string {
  const heading = entry.role === 'user' ? YOU : CLAUDE;
  const activity =
    entry.role === 'assistant' && entry.activity.length > 0
      ? `\n\n${entry.activity.map(quoteActivity).join('\n')}`
      : '';
  const words = escapeHeadings(entry.text.trim());
  return `${heading}\n\n${words}${activity}\n`;
}

/**
 * A tool line holds the model's own input, which may have newlines in it: every
 * line of it is quoted, so none can stand on its own as one of the note's headings.
 */
function quoteActivity(line: string): string {
  return line
    .split('\n')
    .map((part) => `> ${part}`)
    .join('\n');
}

/**
 * A line of what was said that reads as one of the note's own headings — with
 * any number of backslashes before it — gets one more, so reading it back can
 * take exactly one off and nothing else a backslash starts is touched.
 */
function escapeHeadings(text: string): string {
  return text
    .split('\n')
    .map((line) => (headingBackslashes(line) === null ? line : `\\${line}`))
    .join('\n');
}

/** How many backslashes stand before a heading lookalike; null when the line is not one. */
function headingBackslashes(line: string): number | null {
  const backslashes = /^\\*/.exec(line)?.[0].length ?? 0;
  return isHeading(line.slice(backslashes)) ? backslashes : null;
}

function isHeading(line: string): boolean {
  return line.trimEnd() === YOU || line.trimEnd() === CLAUDE;
}

/** The messages in a chat note's body, in order; anything before the first heading is left out. */
export function readChatNote(body: string): ChatNoteMessage[] {
  const messages: { role: 'user' | 'assistant'; lines: string[] }[] = [];
  for (const line of body.split('\n')) {
    if (isHeading(line)) {
      messages.push({ role: line.trimEnd() === YOU ? 'user' : 'assistant', lines: [] });
      continue;
    }
    messages.at(-1)?.lines.push((headingBackslashes(line) ?? 0) > 0 ? line.slice(1) : line);
  }
  return messages.map(({ role, lines }) => ({ role, text: lines.join('\n').trim() }));
}
