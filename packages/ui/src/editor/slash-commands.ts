import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { pickerSuggestion, type PickerView } from './picker-suggestion.ts';

export interface SlashCommand {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly run: (editor: Editor, range: Range) => void;
}

/** Only blocks the markdown serializer can write are offered. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    hint: '#',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: '##',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: '###',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    hint: '-',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Numbered list',
    hint: '1.',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'task',
    label: 'Task list',
    hint: '- [ ]',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: '>',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Code block',
    hint: '```',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'callout',
    label: 'Callout',
    hint: '> [!note]',
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'callout',
          attrs: { kind: 'note', title: null, fold: null },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    id: 'table',
    label: 'Table',
    hint: '| a | b |',
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
        .run(),
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: '---',
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

export type SlashCommandView = PickerView<SlashCommand>;

export interface SlashCommandsOptions {
  onView: (view: SlashCommandView | null) => void;
  /** Offers "Link to note", which asks the page for a note by {@link LINK_REQUEST}. */
  offerLink?: boolean;
  /** Offers "Image", which asks the page for a file by {@link IMAGE_REQUEST}. */
  offerImage?: boolean;
}

/**
 * Raised on the editor's element by "Link to note". An event rather than a
 * callback, so the page can answer it with whatever it holds now without the
 * editor being rebuilt each time that changes.
 */
export const LINK_REQUEST = 'atlas:link-request';

/**
 * "Link to note": clears the typed `/link`, leaving the cursor where it was, so
 * the link the picker comes back with lands there.
 */
const LINK_COMMAND: SlashCommand = {
  id: 'link',
  label: 'Link to note',
  hint: '[[ ]]',
  run: (editor, range) => {
    editor.chain().focus().deleteRange(range).run();
    editor.view.dom.dispatchEvent(new CustomEvent(LINK_REQUEST));
  },
};

/** Raised on the editor's element by "Image", as {@link LINK_REQUEST} is by "Link to note". */
export const IMAGE_REQUEST = 'atlas:image-request';

/** "Image": clears the typed `/image`, so the picked image lands where it was typed. */
const IMAGE_COMMAND: SlashCommand = {
  id: 'image',
  label: 'Image',
  hint: '![]()',
  run: (editor, range) => {
    editor.chain().focus().deleteRange(range).run();
    editor.view.dom.dispatchEvent(new CustomEvent(IMAGE_REQUEST));
  },
};

const matching = (query: string, options: SlashCommandsOptions): SlashCommand[] => {
  const offered = [
    ...SLASH_COMMANDS,
    ...(options.offerLink === true ? [LINK_COMMAND] : []),
    ...(options.offerImage === true ? [IMAGE_COMMAND] : []),
  ];
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return [...offered];
  return offered.filter((command) => command.label.toLowerCase().includes(wanted));
};

/** Blocks offered by typing `/` at the start of an empty line. */
export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slashCommands',

  addOptions() {
    return { onView: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      pickerSuggestion<SlashCommand>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommands'),
        char: '/',
        startOfLine: true,
        find: (query) => matching(query, options),
        onView: (view) => options.onView(view),
        command: ({ editor, range, props: command }) => command.run(editor, range),
      }),
    ];
  },
});
