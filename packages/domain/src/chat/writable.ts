import { isMarkdownName } from '../vault/vault-entry.ts';
import { CHATS_FOLDER, isInChats } from './chat-note.ts';

/**
 * Why the chat may not propose a change to this path, or null when it may.
 *
 * A note's own text is fair game once the person accepts. What is hidden —
 * `.atlas` (views, templates, sources that send secrets), dot-folders — is
 * configuration the model has no business rewriting, even with a click: a
 * source note sent there could aim a Keychain secret at another path
 * (ADR-0017), and the same text reads as a harmless diff. `Chats/` is the
 * record of what was said, which a chat rewriting would make worthless.
 */
export function chatWriteRefusal(path: string): string | null {
  if (path.trim() === '') return 'A path is needed.';
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return `${JSON.stringify(path)} is not a path inside the vault.`;
  }
  if (segments.some((segment) => segment.startsWith('.'))) {
    return `${JSON.stringify(path)} is hidden configuration; the chat does not change it.`;
  }
  if (isInChats(path)) {
    return `${JSON.stringify(path)} is in ${CHATS_FOLDER}/, the record of past chats; the chat does not change it.`;
  }
  if (!isMarkdownName(path)) return `${JSON.stringify(path)} is not a note.`;
  return null;
}
