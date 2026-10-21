// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, NO_LINK_HINTS, noteNames } from '@atlas/domain';
import { NoteNamesProvider } from '../note-names.tsx';
import { LinkHintsProvider } from './link-hints.tsx';
import { optionNamed, suggestedTitles } from './link-suggest.test-support.ts';
import { useLinkInText } from './use-link-in-text.tsx';

afterEach(cleanup);

const NOTES = [
  { path: 'People/Mara Quill.md', title: 'Mara Quill' },
  { path: 'People/Tobias Fenn.md', title: 'Tobias Fenn' },
];

function Field({ onText }: { onText: (text: string) => void }) {
  const [text, setText] = useState('');
  const links = useLinkInText({
    value: text,
    onText: (next) => {
      setText(next);
      onText(next);
    },
    onBlur: () => {},
  });
  return (
    <span className="link-combo">
      <input id="notes" type="text" value={text} {...links.field} />
      {links.list}
    </span>
  );
}

function field() {
  const onText = vi.fn();
  const want = vi.fn();
  render(
    <NoteNamesProvider
      value={noteNames(NOTES.map((note) => ({ ...note, path: createVaultPath(note.path) })))}
    >
      <LinkHintsProvider value={{ hints: NO_LINK_HINTS, notes: NOTES, problem: null, want }}>
        <label htmlFor="notes">Notes</label>
        <Field onText={onText} />
      </LinkHintsProvider>
    </NoteNamesProvider>,
  );
  return { input: screen.getByLabelText('Notes') as HTMLInputElement, onText, want };
}

describe('useLinkInText', () => {
  it('opens again when the caret moves into another [[ after Esc closed the list', async () => {
    const { input } = field();
    await userEvent.type(input, '[[[[ma and [[[[to');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    // The same text; the caret goes back into the first link.
    await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(input.selectionStart).toBe(4);
    expect(suggestedTitles()).toEqual(['Mara Quill']);
  });
  it('is a plain field until [[ is typed, and reads nothing before', async () => {
    const { input, want } = field();
    await userEvent.type(input, 'Met with ');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(want).not.toHaveBeenCalled();
    await userEvent.type(input, '[[[['); // `[[` is how user-event types one `[`
    expect(want).toHaveBeenCalled();
    expect(suggestedTitles()).toEqual(['Mara Quill', 'Tobias Fenn']);
  });

  it('narrows to what follows the [[, and puts the link in on Enter', async () => {
    const { input, onText } = field();
    await userEvent.type(input, 'Met with [[[[tob');
    expect(suggestedTitles()).toEqual(['Tobias Fenn']);
    await userEvent.keyboard('{Enter}');
    expect(input.value).toBe('Met with [[Tobias Fenn]]');
    expect(onText).toHaveBeenLastCalledWith('Met with [[Tobias Fenn]]');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.selectionStart).toBe(input.value.length);
  });

  it('puts the link in where it was clicked', async () => {
    const { input } = field();
    await userEvent.type(input, '[[[[ma');
    await userEvent.click(screen.getByRole('option', { name: optionNamed('Mara Quill') }));
    expect(input.value).toBe('[[Mara Quill]]');
  });

  it('closes on Esc until the text changes', async () => {
    const { input } = field();
    await userEvent.type(input, '[[[[ma');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.type(input, 'r');
    expect(suggestedTitles()).toEqual(['Mara Quill']);
  });
});
