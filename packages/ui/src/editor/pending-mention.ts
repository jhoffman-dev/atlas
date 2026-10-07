import { Node, type Editor, type JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';

/** The node that stands where an `@` was while the person picked is being made. */
export const PENDING_MENTION = 'mentionPending';

/** What became of a person being made: the link to write, or the words to put back. */
export type MentionOutcome =
  | { readonly kind: 'linked'; readonly target: string }
  | { readonly kind: 'failed'; readonly typed: string };

interface PendingMentionStorage {
  /** Each placeholder's outcome by its id, once known. */
  outcomes: Map<string, MentionOutcome>;
}

declare module '@tiptap/core' {
  interface Storage {
    mentionPending: PendingMentionStorage;
  }
}

const key = new PluginKey('pendingMention');

let made = 0;

/** An id for a new placeholder, unique within the app's run. */
function nextPlaceholderId(): string {
  made += 1;
  return `pending-${made}`;
}

/** The placeholder for `name`, as content to insert where the `@` was. */
export function pendingMentionContent(name: string): { id: string; content: JSONContent } {
  const id = nextPlaceholderId();
  return { id, content: { type: PENDING_MENTION, attrs: { id, name } } };
}

/**
 * Where a person picked from `@` will be linked, shown as `@Name` while their
 * note is made (A21-02). It is the editor's alone: never read from HTML, and
 * left out of what is saved ({@link withoutPendingMentions}), so a save in the
 * meantime writes the note as if it were not there.
 *
 * Text typed meanwhile goes after it. Once the person exists it is swapped for
 * the link, or for the words typed if they could not be made — and if it has
 * gone by then (an undo, the note re-read from disk) nothing is written. A redo
 * that brings back one already answered is answered again at once.
 */
export const PendingMention = Node.create<Record<string, never>, PendingMentionStorage>({
  name: PENDING_MENTION,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addStorage() {
    return { outcomes: new Map<string, MentionOutcome>() };
  },

  addAttributes() {
    return { id: { default: '' }, name: { default: '' } };
  },

  parseHTML() {
    return [];
  },

  renderHTML({ node }) {
    return [
      'span',
      { class: 'mention-pending', 'aria-busy': 'true' },
      `@${String(node.attrs['name'])}`,
    ];
  },

  addProseMirrorPlugins() {
    const { outcomes } = this.storage;
    return [
      new Plugin({
        key,
        appendTransaction: (transactions, _before, state) => {
          const answered = outcomes.size > 0 && transactions.some(isHistoryTransaction);
          return answered ? settled(state, outcomes) : null;
        },
      }),
    ];
  },
});

/**
 * Records what became of the placeholder `id` and puts it into the note.
 * Answers whether the placeholder was still there to take it.
 */
export function settlePendingMention(
  editor: Editor,
  { id, outcome }: { id: string; outcome: MentionOutcome },
): boolean {
  if (editor.isDestroyed) return false;
  editor.storage.mentionPending.outcomes.set(id, outcome);
  const transaction = settled(editor.state, new Map([[id, outcome]]));
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}

/** The placeholders with an outcome swapped for it, or null when there are none. */
function settled(
  state: EditorState,
  outcomes: ReadonlyMap<string, MentionOutcome>,
): Transaction | null {
  const found: { from: number; to: number; outcome: MentionOutcome }[] = [];
  state.doc.descendants((node, position) => {
    if (node.type.name !== PENDING_MENTION) return true;
    const outcome = outcomes.get(String(node.attrs['id']));
    if (outcome !== undefined)
      found.push({ from: position, to: position + node.nodeSize, outcome });
    return false;
  });
  if (found.length === 0) return null;
  const transaction = state.tr;
  // Last first, so the earlier positions still hold.
  for (const { from, to, outcome } of found.reverse()) {
    transaction.replaceWith(from, to, replacementFor(state, outcome));
  }
  // Not a step of its own to undo: undoing the pick takes the link with it.
  return transaction.setMeta('addToHistory', false);
}

function replacementFor(state: EditorState, outcome: MentionOutcome): ProseMirrorNode {
  const { schema } = state;
  if (outcome.kind === 'failed') return schema.text(outcome.typed);
  const link = schema.nodes['wikiLink'];
  if (link === undefined) throw new Error('A mention needs the wiki link node.');
  return link.create({ target: outcome.target, heading: null, alias: null });
}

/**
 * A document as it is saved: without placeholders, and with the text either
 * side of one joined again, as the paragraph reads without it.
 */
export function withoutPendingMentions<Doc extends JSONContent>(doc: Doc): Doc {
  if (doc.content === undefined) return doc;
  const kept = doc.content.filter((child) => child.type !== PENDING_MENTION);
  if (kept.length === doc.content.length && !doc.content.some(holdsPending)) return doc;
  return { ...doc, content: joinText(kept.map((child) => withoutPendingMentions(child))) };
}

function holdsPending(node: JSONContent): boolean {
  return (node.content ?? []).some(
    (child) => child.type === PENDING_MENTION || holdsPending(child),
  );
}

function joinText(nodes: readonly JSONContent[]): JSONContent[] {
  const joined: JSONContent[] = [];
  for (const node of nodes) {
    const before = joined.at(-1);
    if (before?.type === 'text' && node.type === 'text' && sameMarks(before, node)) {
      joined[joined.length - 1] = { ...before, text: `${before.text ?? ''}${node.text ?? ''}` };
    } else {
      joined.push(node);
    }
  }
  return joined;
}

function sameMarks(left: JSONContent, right: JSONContent): boolean {
  return JSON.stringify(left.marks ?? []) === JSON.stringify(right.marks ?? []);
}
