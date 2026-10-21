// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { createVaultPath, type NoteSuggestion } from '@dfai/domain';
import type { BlockPicking } from './block-picking.ts';
import { createEditorExtensions } from './extensions.ts';
import {
  withCreate,
  type LinkedNoteMaker,
  type WikiSuggestionView,
} from './wiki-link-suggestion.ts';

/** #465: `[[` in the editor offers "Create '<typed>'" when no note answers to it. */

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const empty: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const GARDEN: NoteSuggestion = { path: createVaultPath('Areas/Garden.md'), target: 'Garden' };
const NONE_TAKEN = () => false;

/** A maker that answers with `made` for what it makes, and takes what it is making. */
function maker(made: (name: string) => string = (name) => name): LinkedNoteMaker & {
  readonly making: Set<string>;
  finish: () => void;
} {
  const making = new Set<string>();
  let finish = () => {};
  return {
    making,
    get finish() {
      return finish;
    },
    named: (name) => making.has(name),
    make: vi.fn(
      (name: string) =>
        new Promise<string>((resolve) => {
          making.add(name);
          finish = () => resolve(made(name));
        }),
    ),
  };
}

function editing({
  suggest = () => [],
  createNote = null,
  picking = null,
  views = [],
}: {
  suggest?: (query: string) => NoteSuggestion[];
  createNote?: LinkedNoteMaker | null;
  picking?: BlockPicking | null;
  views?: (WikiSuggestionView | null)[];
}) {
  editor = new Editor({
    extensions: createEditorExtensions({
      suggest,
      onView: (view) => views.push(view),
      onSlashView: () => {},
      suggestTags: () => [],
      onTagView: () => {},
      onOpenTag: null,
      offerLink: false,
      loadImage: async () => null,
      embedImage: null,
      createNote,
      picking,
    }),
    content: empty,
  });
  editor.commands.focus('end');
  return editor;
}

/** Types as a person does, so the suggestion plugin sees each keystroke. */
function typeInto(instance: Editor, text: string) {
  for (const char of text) {
    const { from, to } = instance.state.selection;
    const handled = instance.view.someProp('handleTextInput', (handle) =>
      handle(instance.view, from, to, char, () => instance.state.tr.insertText(char, from, to)),
    );
    if (handled !== true) instance.view.dispatch(instance.state.tr.insertText(char, from, to));
  }
}

const paragraphOf = (instance: Editor) => instance.getJSON().content?.[0]?.content ?? [];

/** Picks the list's "Create" row for `name`, once the list offers it for all that was typed. */
async function pickCreate(views: (WikiSuggestionView | null)[], name: string) {
  await vi.waitFor(() => expect(views.at(-1)?.items.at(-1)).toEqual({ kind: 'create', name }));
  const view = views.at(-1);
  const create = view?.items.at(-1);
  if (view === null || view === undefined || create === undefined) throw new Error('no list');
  view.insert(create);
}

describe('withCreate', () => {
  it('offers to make a note when none offered is called what was typed', () => {
    expect(withCreate([GARDEN], 'Gard', NONE_TAKEN).map((choice) => choice.kind)).toEqual([
      'note',
      'create',
    ]);
    expect(withCreate([], ' Mara Quill ', NONE_TAKEN).at(-1)).toEqual({
      kind: 'create',
      name: 'Mara Quill',
    });
  });

  it('offers none when a note offered is already called that, whatever its case', () => {
    expect(withCreate([GARDEN], 'garden', NONE_TAKEN).map((choice) => choice.kind)).toEqual([
      'note',
    ]);
  });

  it('offers none for a name a note not offered answers to — an archived one', () => {
    const archived = (name: string) => name === 'Foo';
    expect(withCreate([], 'Foo', archived)).toEqual([]);
  });

  it('offers none for a name holding a folder, an alias or a heading', () => {
    for (const typed of ['Plans/Offsite', 'Offsite|the trip', 'Offsite#Day one']) {
      expect(withCreate([], typed, NONE_TAKEN)).toEqual([]);
    }
  });

  it('offers it for a name with a colon: the note made says what it was called', () => {
    expect(withCreate([], 'Q3: plan', NONE_TAKEN)).toEqual([{ kind: 'create', name: 'Q3: plan' }]);
  });

  it('offers none for nothing typed', () => {
    expect(withCreate([], '  ', NONE_TAKEN)).toEqual([]);
  });
});

describe('[[ Create in the editor', () => {
  it('stands a placeholder where it was typed, then links the note as it was made', async () => {
    const views: (WikiSuggestionView | null)[] = [];
    const notes = maker((name) => name.replace(':', ''));
    const instance = editing({ createNote: notes, views });
    typeInto(instance, 'See [[Q3: plan');
    await pickCreate(views, 'Q3: plan');
    expect(notes.make).toHaveBeenCalledWith('Q3: plan');
    expect(instance.view.dom.querySelector('.mention-pending')?.textContent).toBe('[[Q3: plan');
    notes.finish();
    await vi.waitFor(() =>
      expect(paragraphOf(instance)).toEqual([
        { type: 'text', text: 'See ' },
        {
          type: 'wikiLink',
          attrs: { target: 'Q3 plan', heading: null, alias: null, embed: false },
        },
        { type: 'text', text: ' ' },
      ]),
    );
  });

  it('links a numbered note by the number it was given', async () => {
    const views: (WikiSuggestionView | null)[] = [];
    const notes = maker(() => 'Mara Quill 2');
    const instance = editing({ createNote: notes, views });
    typeInto(instance, '[[Mara Quill');
    await pickCreate(views, 'Mara Quill');
    notes.finish();
    await vi.waitFor(() =>
      expect(JSON.stringify(paragraphOf(instance))).toContain('"target":"Mara Quill 2"'),
    );
  });

  it('offers no second Create for a name while its note is being made', async () => {
    const views: (WikiSuggestionView | null)[] = [];
    const notes = maker();
    const suggest = vi.fn((): NoteSuggestion[] => []);
    const instance = editing({ suggest, createNote: notes, views });
    typeInto(instance, '[[Mara Quill');
    await pickCreate(views, 'Mara Quill');
    const before = views.length;
    typeInto(instance, 'and [[Mara Quill');
    await vi.waitFor(() => expect(suggest).toHaveBeenLastCalledWith('Mara Quill'));
    await vi.waitFor(() => expect(views.length).toBeGreaterThan(before));
    await new Promise((settle) => setTimeout(settle, 0));
    expect(views.at(-1)?.items.some((item) => item.kind === 'create') ?? false).toBe(false);
    expect(notes.make).toHaveBeenCalledTimes(1);
  });

  it('puts the words back when the note cannot be made', async () => {
    const views: (WikiSuggestionView | null)[] = [];
    const refusing: LinkedNoteMaker = {
      named: NONE_TAKEN,
      make: async () => {
        throw new Error('The disk is full.');
      },
    };
    const instance = editing({ createNote: refusing, views });
    typeInto(instance, 'See [[Tobias');
    await pickCreate(views, 'Tobias');
    await vi.waitFor(() =>
      expect(paragraphOf(instance)).toEqual([{ type: 'text', text: 'See [[Tobias ' }]),
    );
  });

  it('offers no Create where notes cannot be made, nor after ![[', async () => {
    const views: (WikiSuggestionView | null)[] = [];
    const instance = editing({ views });
    typeInto(instance, '[[Tobias');
    await vi.waitFor(() => expect(views.length).toBeGreaterThan(0));
    expect(views.some((view) => view?.items.some((item) => item.kind === 'create'))).toBe(false);
    editor?.destroy();
    const embedViews: (WikiSuggestionView | null)[] = [];
    const embedding = editing({ createNote: maker(), views: embedViews });
    typeInto(embedding, '![[Tobias');
    await vi.waitFor(() => expect(embedViews.length).toBeGreaterThan(0));
    expect(
      embedViews.some((view) => view?.embed && view.items.some((item) => item.kind === 'create')),
    ).toBe(false);
  });

  it('lists a note’s headings after # and no Create, even where notes can be made', async () => {
    const views: (WikiSuggestionView | null)[] = [];
    const picking: BlockPicking = {
      choicesFor: async () => ({
        same: false,
        target: 'Garden',
        path: createVaultPath('Areas/Garden.md'),
        entries: [{ kind: 'heading', text: 'Beds', level: 2, at: [0] }],
      }),
      anchor: async () => 'x',
      newId: () => 'x',
      onRefused: () => {},
    };
    const instance = editing({ suggest: () => [GARDEN], createNote: maker(), picking, views });
    typeInto(instance, '[[Garden#Be');
    await vi.waitFor(() =>
      expect(views.at(-1)?.items.map((item) => item.kind)).toEqual(['fragment']),
    );
  });
});
