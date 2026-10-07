// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { createVaultPath, type MentionSuggestion, type PersonChip } from '@atlas/domain';
import { createEditorExtensions, type EditorPeople } from './extensions.ts';
import type { MentionSuggestionView } from './mention-suggestion.ts';
import { redrawPersonChips } from './person-chips.ts';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const empty: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const JULIE: MentionSuggestion = {
  kind: 'person',
  path: createVaultPath('People/Julie Brandt.md'),
  name: 'Julie Brandt',
  target: 'Julie Brandt',
};

function editing({
  people = {},
  content = empty,
}: { people?: Partial<EditorPeople>; content?: JSONContent } = {}) {
  editor = new Editor({
    extensions: createEditorExtensions({
      suggest: () => [],
      onView: () => {},
      onSlashView: () => {},
      suggestTags: () => [],
      onTagView: () => {},
      onOpenTag: null,
      offerLink: false,
      loadImage: async () => null,
      embedImage: null,
      people: {
        suggest: () => [],
        onView: () => {},
        create: null,
        personFor: () => null,
        ...people,
      },
    }),
    content,
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

/** Presses a key as the view would hear it. */
function press(instance: Editor, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  instance.view.someProp('handleKeyDown', (handle) => handle(instance.view, event));
}

describe('@ in the editor', () => {
  it('asks for people with what follows the @, names and all', async () => {
    const suggest = vi.fn((): readonly MentionSuggestion[] => [JULIE]);
    const views: (MentionSuggestionView | null)[] = [];
    editing({ people: { suggest, onView: (view) => views.push(view) } });
    typeInto(editor!, 'Call @Julie M');
    expect(suggest).toHaveBeenLastCalledWith('Julie M');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([JULIE]));
  });

  it('writes the person picked as a plain wiki link where the @ was', async () => {
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({ people: { suggest: () => [JULIE], onView: (v) => views.push(v) } });
    typeInto(instance, 'Call @Jul');
    await vi.waitFor(() => expect(views.at(-1)?.items).toHaveLength(1));
    views.at(-1)?.insert(JULIE);
    expect(paragraphOf(instance)).toEqual([
      { type: 'text', text: 'Call ' },
      {
        type: 'wikiLink',
        attrs: { target: 'Julie Brandt', heading: null, alias: null, embed: false },
      },
      { type: 'text', text: ' ' },
    ]);
  });

  it('is offered after a bracket, and at the start of a line', () => {
    const suggest = vi.fn((): readonly MentionSuggestion[] => []);
    editing({ people: { suggest } });
    typeInto(editor!, '@a');
    expect(suggest).toHaveBeenLastCalledWith('a');
    editor?.destroy();
    editing({ people: { suggest } });
    typeInto(editor!, 'see (@b');
    expect(suggest).toHaveBeenLastCalledWith('b');
  });

  it('is never offered inside a word, so an email address is left alone', () => {
    const suggest = vi.fn((): readonly MentionSuggestion[] => []);
    editing({ people: { suggest } });
    typeInto(editor!, 'mail a@b.com or name@host');
    expect(suggest).not.toHaveBeenCalled();
  });

  it('is never offered in inline code, a code block or a link', () => {
    const suggest = vi.fn((): readonly MentionSuggestion[] => []);
    for (const content of [
      { type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }] },
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'code' }] }] },
        ],
      },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'see', marks: [{ type: 'link', attrs: { href: 'u' } }] },
            ],
          },
        ],
      },
    ]) {
      editor?.destroy();
      const instance = editing({ people: { suggest }, content });
      typeInto(instance, ' @x');
      expect(suggest).not.toHaveBeenCalled();
    }
  });
});

describe('a new person from @', () => {
  const CREATE: MentionSuggestion = { kind: 'create', name: 'Ann Lee' };

  it('is made, then linked where the @ was by the name the note was given', async () => {
    const create = vi.fn(async () => 'Ann Lee 2');
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: { suggest: () => [CREATE], onView: (v) => views.push(v), create },
    });
    typeInto(instance, 'With @Ann Lee');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
    views.at(-1)?.insert(CREATE);

    expect(create).toHaveBeenCalledWith('Ann Lee');
    await vi.waitFor(() =>
      expect(paragraphOf(instance)).toEqual([
        { type: 'text', text: 'With ' },
        {
          type: 'wikiLink',
          attrs: { target: 'Ann Lee 2', heading: null, alias: null, embed: false },
        },
        { type: 'text', text: ' ' },
      ]),
    );
  });

  it('puts back what was typed when the person cannot be made, without reopening the list', async () => {
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: {
        suggest: () => [CREATE],
        onView: (v) => views.push(v),
        create: () => Promise.reject(new Error('disk full')),
      },
    });
    typeInto(instance, 'With @Ann Lee');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
    views.at(-1)?.insert(CREATE);
    // The space after is the one picking adds, as it does after a person.
    await vi.waitFor(() => expect(instance.getText()).toBe('With @Ann Lee '));
    expect(views.at(-1)).toBeNull();
    // Nor does typing on from there bring it back: the list was answered.
    typeInto(instance, 'x');
    expect(views.at(-1)).toBeNull();
  });

  it('shows who is being made where the @ was, while the note is made', async () => {
    let finish!: (target: string) => void;
    const create = vi.fn(
      () =>
        new Promise<string>((settle) => {
          finish = settle;
        }),
    );
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: { suggest: () => [CREATE], onView: (v) => views.push(v), create },
    });
    typeInto(instance, 'With @Ann Lee');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
    views.at(-1)?.insert(CREATE);
    const placeholder = instance.view.dom.querySelector('.mention-pending');
    expect(placeholder?.textContent).toBe('@Ann Lee');
    finish('Ann Lee');
    await vi.waitFor(() => expect(instance.view.dom.querySelector('.mention-pending')).toBeNull());
  });

  it('says so, and writes no link, when the placeholder went before the person was made', async () => {
    let finish!: (target: string) => void;
    const notLinked = vi.fn();
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: {
        suggest: () => [CREATE],
        onView: (v) => views.push(v),
        create: () =>
          new Promise<string>((settle) => {
            finish = settle;
          }),
        notLinked,
      },
    });
    typeInto(instance, 'With @Ann Lee');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
    views.at(-1)?.insert(CREATE);
    instance.commands.setContent('<p>Written elsewhere.</p>', { emitUpdate: false });
    finish('Ann Lee');
    await vi.waitFor(() => expect(notLinked).toHaveBeenCalledWith('Ann Lee'));
    expect(instance.getText()).toBe('Written elsewhere.');
  });

  it('is undone as one step, the link going back to the words typed', async () => {
    let finish!: (target: string) => void;
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: {
        suggest: () => [CREATE],
        onView: (v) => views.push(v),
        create: () =>
          new Promise<string>((settle) => {
            finish = settle;
          }),
      },
    });
    typeInto(instance, 'With @Ann Lee');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
    instance.view.dispatch(closeHistory(instance.state.tr));
    views.at(-1)?.insert(CREATE);
    // The note takes a while to make: longer than the history groups steps.
    instance.view.dispatch(closeHistory(instance.state.tr));
    finish('Ann Lee');
    await vi.waitFor(() => expect(paragraphOf(instance)[1]?.type).toBe('wikiLink'));
    instance.commands.undo();
    // Never a placeholder waiting for a person already made.
    expect(paragraphOf(instance)).toEqual([{ type: 'text', text: 'With @Ann Lee' }]);
  });

  it('links the person made when a redo brings back a placeholder undone while they were made', async () => {
    let finish!: (target: string) => void;
    const notLinked = vi.fn();
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: {
        suggest: () => [CREATE],
        onView: (v) => views.push(v),
        create: () =>
          new Promise<string>((settle) => {
            finish = settle;
          }),
        notLinked,
      },
    });
    typeInto(instance, 'With @Ann Lee');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
    // A person pauses before picking: the typing is an undo step of its own.
    instance.view.dispatch(closeHistory(instance.state.tr));
    views.at(-1)?.insert(CREATE);
    instance.commands.undo();
    expect(instance.getText()).toBe('With @Ann Lee');
    finish('Ann Lee');
    await vi.waitFor(() => expect(notLinked).toHaveBeenCalledWith('Ann Lee'));
    instance.commands.redo();
    expect(instance.view.dom.querySelector('.mention-pending')).toBeNull();
    expect(paragraphOf(instance)[1]).toMatchObject({
      type: 'wikiLink',
      attrs: { target: 'Ann Lee' },
    });
  });

  it('is not what Enter picks when it is all the list offers: Enter makes a new line', async () => {
    const create = vi.fn(async () => 'Ann Lee');
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: { suggest: () => [CREATE], onView: (v) => views.push(v), create },
    });
    typeInto(instance, 'With @Ann Lee');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
    expect(views.at(-1)?.selected).toBe(-1);
    press(instance, 'Enter');
    expect(create).not.toHaveBeenCalled();
    expect(instance.getJSON().content).toHaveLength(2);
    expect(views.at(-1)).toBeNull();
  });

  it('is picked with ↓ then Enter', async () => {
    const create = vi.fn(async () => 'Ann Lee');
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: { suggest: () => [CREATE], onView: (v) => views.push(v), create },
    });
    typeInto(instance, 'With @Ann Lee');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
    press(instance, 'ArrowDown');
    expect(views.at(-1)?.selected).toBe(0);
    press(instance, 'Enter');
    expect(create).toHaveBeenCalledWith('Ann Lee');
  });

  it('is not what Enter picks after someone who cannot be linked', async () => {
    const create = vi.fn(async () => 'Ann Lee');
    const unlinkable: MentionSuggestion = {
      kind: 'unlinkable',
      path: createVaultPath('People/Ann #2.md'),
      name: 'Ann #2',
      reason: '“Ann #2” cannot be linked',
    };
    const views: (MentionSuggestionView | null)[] = [];
    const instance = editing({
      people: { suggest: () => [unlinkable, CREATE], onView: (v) => views.push(v), create },
    });
    typeInto(instance, 'With @Ann');
    await vi.waitFor(() => expect(views.at(-1)?.items).toHaveLength(2));
    expect(views.at(-1)?.selected).toBe(-1);
    // Picking them writes nothing: there is no link that would open them.
    views.at(-1)?.insert(unlinkable);
    expect(instance.getText()).toBe('With @Ann');
  });

  it('is not offered where people cannot be made', async () => {
    const views: (MentionSuggestionView | null)[] = [];
    editing({ people: { suggest: () => [JULIE, CREATE], onView: (v) => views.push(v) } });
    typeInto(editor!, '@Ann');
    await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([JULIE]));
  });
});

describe('a link to a person', () => {
  const linked: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ask ' },
          { type: 'wikiLink', attrs: { target: 'Julie', heading: null, alias: null } },
          { type: 'text', text: ' about ' },
          { type: 'wikiLink', attrs: { target: 'Plan', heading: null, alias: null } },
        ],
      },
    ],
  };
  const chips = (instance: Editor) =>
    [...instance.view.dom.querySelectorAll('.wikilink--person')].map((element) => [
      element.textContent,
      element.getAttribute('data-initial'),
    ]);

  it('is drawn as their chip, and a link to anything else as a link', () => {
    const instance = editing({
      people: {
        personFor: (target) => (target === 'Julie' ? { name: 'Julie', initial: 'J' } : null),
      },
      content: linked,
    });
    expect(chips(instance)).toEqual([['Julie', 'J']]);
    expect(instance.view.dom.querySelectorAll('.wikilink')).toHaveLength(2);
  });

  it('stays a plain wiki link in the document', () => {
    const instance = editing({
      people: { personFor: () => ({ name: 'Julie', initial: 'J' }) },
      content: linked,
    });
    expect(paragraphOf(instance)[1]).toEqual({
      type: 'wikiLink',
      attrs: { target: 'Julie', heading: null, alias: null, embed: false },
    });
  });

  it('is looked up again only where the note changed, not on every keystroke', () => {
    const personFor = vi.fn((target: string) =>
      target === 'Julie' ? { name: 'Julie', initial: 'J' } : null,
    );
    const instance = editing({
      people: { personFor },
      content: {
        type: 'doc',
        content: [
          ...(linked.content ?? []),
          { type: 'paragraph', content: [{ type: 'text', text: 'Notes' }] },
        ],
      },
    });
    personFor.mockClear();
    typeInto(instance, ' more');
    expect(personFor).not.toHaveBeenCalled();
    // The chips drawn before are still drawn, moved with the text.
    expect(chips(instance)).toEqual([['Julie', 'J']]);

    instance.commands.insertContent({
      type: 'wikiLink',
      attrs: { target: 'Julie', heading: null, alias: null },
    });
    expect(personFor.mock.calls).toEqual([['Julie']]);
    expect(chips(instance)).toEqual([
      ['Julie', 'J'],
      ['Julie', 'J'],
    ]);
  });

  it('is drawn again when the vault’s people change', () => {
    let known: PersonChip | null = null;
    const instance = editing({ people: { personFor: () => known }, content: linked });
    expect(chips(instance)).toEqual([]);
    known = { name: 'Plan', initial: 'P' };
    redrawPersonChips(instance);
    expect(chips(instance)).toEqual([
      ['Julie', 'P'],
      ['Plan', 'P'],
    ]);
  });
});
