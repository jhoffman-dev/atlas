import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import {
  anchorsIn,
  blockOutline,
  matchingOutline,
  offeredByOwnId,
  type EditorDocument,
  type NoteSuggestion,
  type WikiLinkOrEmbed,
} from '@atlas/domain';
import { pickerSuggestion, type PickerView } from './picker-suggestion.ts';
import { showAsBookmark } from './bookmark-commands.ts';
import { followRange, insertBlockLink } from './block-link-commands.ts';
import type { BlockPicking, LinkChoice } from './block-picking.ts';

export type WikiSuggestionView = PickerView<LinkChoice> & {
  /** `![[`: what is picked is shown in place rather than linked to. */
  readonly embed: boolean;
};

export interface WikiLinkSuggestionOptions {
  /** Notes matching what has been typed so far. */
  suggest: (query: string) => NoteSuggestion[];
  /** Called whenever the popup should appear, move, or close. */
  onView: (view: WikiSuggestionView | null) => void;
  /** A note's headings and blocks after `#`; left out, `#` offers nothing. */
  blocks: BlockPicking | null;
}

/**
 * Offers notes after `[[`, and after `![[` (P26-02); then, once a `#`
 * follows a note's name, that note's headings and blocks, each with a line
 * of what it says, as Capacities offers them. Picking a note after `![[`
 * goes straight on to its blocks.
 */
export const WikiLinkSuggestion = Extension.create<WikiLinkSuggestionOptions>({
  name: 'wikiLinkSuggestion',

  addOptions() {
    return {
      suggest: () => [],
      onView: () => {},
      blocks: null,
    };
  },

  addProseMirrorPlugins() {
    return [
      linkPicker({ options: this.options, editor: this.editor, embed: false }),
      linkPicker({ options: this.options, editor: this.editor, embed: true }),
    ];
  },
});

function linkPicker({
  options,
  editor,
  embed,
}: {
  options: WikiLinkSuggestionOptions;
  editor: Editor;
  embed: boolean;
}) {
  return pickerSuggestion<LinkChoice>({
    editor,
    // Each suggester needs its own key; two plugins cannot share one.
    pluginKey: new PluginKey(embed ? 'embedSuggestion' : 'wikiLinkSuggestion'),
    char: embed ? '![[' : '[[',
    startOfLine: false,
    allowSpaces: true,
    find: (query, current) => choicesFor({ query, editor: current, options }),
    onView: (view) => options.onView(view === null ? null : { ...view, embed }),
    // Shift+Enter: the link goes in as a card, where a card can go.
    alternate: embed
      ? null
      : ({ editor: current, range, item }) => {
          if (item.kind !== 'note') return;
          current
            .chain()
            .focus()
            .insertContentAt(range, {
              type: 'wikiLink',
              attrs: { target: item.note.target, heading: null, alias: null },
            })
            .run();
          showAsBookmark(current, range.from);
        },
    command: ({ editor: current, range, props: item }) =>
      pick({ editor: current, range, item, embed, blocks: options.blocks }),
  });
}

/**
 * What the picker offers for `query`: notes, at once — or, after a `#`, the
 * named note's headings and blocks, once the note is read.
 */
function choicesFor({
  query,
  editor,
  options,
}: {
  query: string;
  editor: Editor;
  options: WikiLinkSuggestionOptions;
}): LinkChoice[] | Promise<LinkChoice[]> {
  const hash = query.indexOf('#');
  if (hash < 0 || options.blocks === null) {
    return options.suggest(query).map((note) => ({ kind: 'note', note }));
  }
  return fragmentsFor({ query, hash, editor, blocks: options.blocks });
}

async function fragmentsFor({
  query,
  hash,
  editor,
  blocks,
}: {
  query: string;
  hash: number;
  editor: Editor;
  blocks: BlockPicking;
}): Promise<LinkChoice[]> {
  const found = await blocks.choicesFor(query.slice(0, hash).trim());
  if (found === null) return [];
  // This note's own blocks, less the one being typed in: it is about to become the link.
  const here = editor.state.selection.$from.index(0);
  const entries = found.same
    ? blockOutline(editor.getJSON() as EditorDocument).filter((entry) => entry.at[0] !== here)
    : found.entries;
  // An id two blocks share is not offered: picking either asks for its own (A26-01).
  return matchingOutline(offeredByOwnId(entries), query.slice(hash + 1)).map((entry) => ({
    kind: 'fragment',
    target: found.target,
    path: found.same ? null : found.path,
    entry,
  }));
}

/** Puts in what was picked. The closing brackets are written here, so a link is never left half-formed. */
function pick({
  editor,
  range,
  item,
  embed,
  blocks,
}: {
  editor: Editor;
  range: Range;
  item: LinkChoice;
  embed: boolean;
  blocks: BlockPicking | null;
}): void {
  if (item.kind === 'note') {
    pickNote({ editor, range, target: item.note.target, embed: embed && blocks !== null });
    return;
  }
  const { entry, target, path } = item;
  const link = (heading: string): WikiLinkOrEmbed => ({ target, heading, alias: null, embed });
  if (entry.kind === 'heading') {
    insertBlockLink(editor, { range, link: link(`#${entry.text}`) });
  } else if (entry.id !== null) {
    insertBlockLink(editor, { range, link: link(`#^${entry.id}`) });
  } else if (path === null) {
    // A block of this note: given its id in the same step as the link to it.
    const id = blocks?.newId(anchorsIn(editor.getJSON() as EditorDocument));
    if (id !== undefined)
      insertBlockLink(editor, { range, link: link(`#^${id}`), anchor: { at: entry.at, id } });
  } else if (blocks !== null) {
    pickBlockOfAnotherNote({
      editor,
      range,
      blocks,
      block: { path, at: entry.at, text: entry.text },
      link,
    });
  }
}

/**
 * A note picked: its link, as ever — or, after `![[`, its name and a `#`,
 * so its headings and blocks are offered next.
 */
function pickNote({
  editor,
  range,
  target,
  embed,
}: {
  editor: Editor;
  range: Range;
  target: string;
  embed: boolean;
}): void {
  const content = embed
    ? [{ type: 'text', text: `![[${target}#` }]
    : [
        { type: 'wikiLink', attrs: { target, heading: null, alias: null } },
        { type: 'text', text: ' ' },
      ];
  editor.chain().focus().insertContentAt(range, content).run();
}

/**
 * A block of another note picked: it is given its id there first — a write
 * to that note, which may be refused — then linked to where it was typed,
 * wherever the typing has moved to meanwhile.
 */
function pickBlockOfAnotherNote({
  editor,
  range,
  blocks,
  block,
  link,
}: {
  editor: Editor;
  range: Range;
  blocks: BlockPicking;
  block: Parameters<BlockPicking['anchor']>[0];
  link: (heading: string) => WikiLinkOrEmbed;
}): void {
  const typed = followRange(editor, range);
  blocks
    .anchor(block)
    .then((id) => {
      if (!editor.isDestroyed)
        insertBlockLink(editor, { range: typed.current(), link: link(`#^${id}`) });
    })
    .catch((cause: unknown) =>
      blocks.onRefused(cause instanceof Error ? cause.message : String(cause)),
    )
    .finally(typed.release);
}
