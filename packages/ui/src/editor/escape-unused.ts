import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

const leftAlone = new WeakSet<Event>();

/**
 * Whether an Escape went through the editor unanswered. ProseMirror prevents
 * the default of every Escape pressed in it, used or not, so what holds the
 * editor — the center peek — cannot tell from `defaultPrevented` whether a
 * suggestion list took it or nothing did.
 */
export function escapeLeftByEditor(event: Event): boolean {
  return leftAlone.has(event);
}

/**
 * Marks an Escape none of the editor's plugins answered. Last of them all,
 * so a suggestion list that closes on Escape takes it first and it is never
 * marked; it leaves the key to ProseMirror, which then prevents it as before.
 */
export const EscapeUnused = Extension.create({
  name: 'escapeUnused',
  // TipTap orders plugins by priority, highest first; the default is 100.
  priority: 1,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => {
            if (event.key === 'Escape') leftAlone.add(event);
            return false;
          },
        },
      }),
    ];
  },
});
