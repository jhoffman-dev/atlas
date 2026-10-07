// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import {
  createVaultPath,
  rankMentionSuggestions,
  type KnownPerson,
  type MentionSuggestion,
} from '@atlas/domain';
import { createEditorExtensions, type EditorPeople } from './extensions.ts';
import type { MentionSuggestionView } from './mention-suggestion.ts';
import { closeHistory } from '@tiptap/pm/history';

/**
 * Attacks on `@` mentions in the editor (P21-02): a new person made while the
 * user keeps working, and Enter at the end of an ordinary sentence.
 */

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const empty: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const CREATE: MentionSuggestion = { kind: 'create', name: 'Ann Lee' };

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

function typeInto(instance: Editor, text: string) {
  for (const char of text) {
    const { from, to } = instance.state.selection;
    const handled = instance.view.someProp('handleTextInput', (handle) =>
      handle(instance.view, from, to, char, () => instance.state.tr.insertText(char, from, to)),
    );
    if (handled !== true) instance.view.dispatch(instance.state.tr.insertText(char, from, to));
  }
}

/** Presses a key as the view would hear it; true when a plugin took it. */
function press(instance: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return instance.view.someProp('handleKeyDown', (handle) => handle(instance.view, event)) === true;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const flush = () => new Promise((settle) => setTimeout(settle, 0));

const paragraphOf = (instance: Editor) => instance.getJSON().content?.[0]?.content ?? [];

/** Starts making "Ann Lee" from `@`, with the note not yet on disk. */
async function startCreating(before = 'With ') {
  const pending = deferred<string>();
  const create = vi.fn(() => pending.promise);
  const views: (MentionSuggestionView | null)[] = [];
  const instance = editing({
    people: { suggest: () => [CREATE], onView: (view) => views.push(view), create },
  });
  typeInto(instance, `${before}@Ann Lee`);
  await vi.waitFor(() => expect(views.at(-1)?.items).toEqual([CREATE]));
  // A person pauses before picking: the typing is its own undo step, as it is
  // after the history's grouping delay in the app.
  instance.view.dispatch(closeHistory(instance.state.tr));
  views.at(-1)?.insert(CREATE);
  expect(create).toHaveBeenCalledWith('Ann Lee');
  return { instance, pending };
}

describe('a new person made while the user keeps typing', () => {
  it('is linked where the @ was, before the words typed while it was being made', async () => {
    const { instance, pending } = await startCreating();
    // The cursor sits where the @ was; the user carries on writing.
    typeInto(instance, 'will call');
    pending.resolve('Ann Lee');
    await flush();

    const link = paragraphOf(instance).findIndex((node) => node.type === 'wikiLink');
    expect(link).toBeGreaterThan(-1);
    expect(paragraphOf(instance).slice(0, link)).toEqual([{ type: 'text', text: 'With ' }]);
  });

  it('is not linked after the user undid the @, so the name never appears twice', async () => {
    const { instance, pending } = await startCreating();
    instance.commands.undo();
    expect(instance.getText()).toBe('With @Ann Lee');
    pending.resolve('Ann Lee');
    await flush();

    const text = instance.getText();
    const links = paragraphOf(instance).filter((node) => node.type === 'wikiLink');
    // Either the undo stands (no link) or the link replaced the typed words — never both.
    expect(links.length === 0 || !text.includes('@Ann Lee')).toBe(true);
  });

  it('is not written into a note re-read from disk while it was being made', async () => {
    const { instance, pending } = await startCreating();
    const reread: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Written elsewhere.' }] }],
    };
    // What NoteEditor does when the other pane or the watcher brings a new version.
    instance.commands.setContent(reread, { emitUpdate: false });
    pending.resolve('Ann Lee');
    await flush();

    expect(instance.getText()).toBe('Written elsewhere.');
    expect(JSON.stringify(instance.getJSON())).not.toContain('wikiLink');
  });
});

describe('Enter at the end of a sentence that began with a mention', () => {
  const bob: KnownPerson = { path: createVaultPath('People/Bob.md'), modified: 1 };
  const suggest = (query: string) =>
    rankMentionSuggestions(query, { people: [bob], linkable: [bob.path] });

  it('does not make a new person of the person and the words after them', async () => {
    const create = vi.fn(async (name: string) => name);
    const instance = editing({ people: { suggest, create } });
    typeInto(instance, 'Ping @Bob about it');
    press(instance, 'Enter');
    await flush();

    expect(create).not.toHaveBeenCalled();
    expect(instance.getText()).toContain('Ping @Bob about it');
  });
});

describe('@ after a character that ends a word but is not a plain space', () => {
  it.each([
    ['a non-breaking space', 'Ask\u00a0'],
    ['an opening quote', 'She said "'],
  ])('offers people after %s', (_label, before) => {
    const suggest = vi.fn((): readonly MentionSuggestion[] => []);
    const instance = editing({ people: { suggest } });
    typeInto(instance, `${before}@Ju`);
    expect(suggest).toHaveBeenLastCalledWith('Ju');
  });
});
