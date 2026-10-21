import { Extension } from '@tiptap/core';
import { PluginKey, type EditorState } from '@tiptap/pm/state';
import type { MentionSuggestion } from '@atlas/domain';
import { exitSuggestion } from '@tiptap/suggestion';
import { linkOnceMade, type MakeLinked } from './pending-mention.ts';
import { pickerSuggestion, type PickerView } from './picker-suggestion.ts';

export type MentionSuggestionView = PickerView<MentionSuggestion>;

/** Makes a person of a name typed after `@`, resolving to what a link to them is written as. */
export type CreatePerson = MakeLinked;

export interface MentionSuggestionOptions {
  /** People for what has been typed after `@`, and the offer to add one. */
  suggest: (query: string) => readonly MentionSuggestion[];
  onView: (view: MentionSuggestionView | null) => void;
  /** Null where a new person cannot be made from here. */
  createPerson: CreatePerson | null;
  /** A person was made, but their placeholder had gone, so no link was written. */
  notLinked: (name: string) => void;
}

const mentionKey = new PluginKey('mentionSuggestion');

/** Text whose `@` is never a mention: code, and a link's words. */
const NOT_MENTIONED_MARKS: ReadonlySet<string> = new Set(['code', 'link']);

/**
 * What may come just before an `@` that starts a mention: a space — plain or
 * non-breaking — an opening bracket or quote, or nothing (the start of a
 * line). Never a letter, so `a@b.com` is left alone.
 */
const BEFORE_A_MENTION = [' ', '\u00a0', '(', '"', "'", '\u201c', '\u2018', '\u00ab'];

/** Whether an `@` at `from` may start a mention: not in code, nor in a link. */
function mayMention(state: EditorState, from: number): boolean {
  const at = state.doc.resolve(from);
  if (at.parent.type.spec.code === true) return false;
  const after = state.doc.resolve(Math.min(from + 1, state.doc.content.size));
  return ![...at.marks(), ...after.marks()].some((mark) => NOT_MENTIONED_MARKS.has(mark.type.name));
}

const linkTo = (target: string) => [
  { type: 'wikiLink', attrs: { target, heading: null, alias: null } },
  { type: 'text', text: ' ' },
];

/**
 * Offers people after `@`; picking one writes an ordinary `[[Name]]` link,
 * which Obsidian reads as it is, and a new name makes the person first.
 *
 * Only after a space, an opening bracket or quote, or the start of a line —
 * so an email address (`a@b.com`) or `name@host` is left alone — and never in
 * code or a link. Spaces are allowed, since names have them; the domain
 * closes the list once what follows reads as a sentence rather than a name.
 *
 * Enter picks the first person offered, never "Create person": when that is
 * all there is, nothing is selected, and Enter is a new line. ↓ selects it.
 */
export const MentionSuggestionExtension = Extension.create<MentionSuggestionOptions>({
  name: 'mentionSuggestion',

  addOptions() {
    return { suggest: () => [], onView: () => {}, createPerson: null, notLinked: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      pickerSuggestion<MentionSuggestion>({
        editor: this.editor,
        pluginKey: mentionKey,
        char: '@',
        startOfLine: false,
        allowSpaces: true,
        allowedPrefixes: BEFORE_A_MENTION,
        allow: ({ state, range }) => mayMention(state, range.from),
        find: (query) =>
          options
            .suggest(query)
            .filter((item) => item.kind !== 'create' || options.createPerson !== null),
        preselects: (item) => item.kind === 'person',
        onView: (view) => options.onView(view),
        command: ({ editor, range, props: item }) => {
          if (item.kind === 'person') {
            editor.chain().focus().insertContentAt(range, linkTo(item.target)).run();
            return;
          }
          // Someone no link could open: listed with why, and nothing to write.
          if (item.kind === 'unlinkable') return;
          const create = options.createPerson;
          if (create === null) return;
          void linkOnceMade(editor, {
            range,
            name: item.name,
            sigil: '@',
            make: create,
            notLinked: options.notLinked,
            closeList: () => exitSuggestion(editor.view, mentionKey),
          });
        },
      }),
    ];
  },
});
