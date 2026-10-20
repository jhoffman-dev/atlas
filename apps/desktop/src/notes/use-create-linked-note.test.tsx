// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fakeMarkdown, fakeVaultFs } from '@atlas/application';
import { createVaultPath } from '@atlas/domain';
import { useCreateLinkedNote } from './use-create-linked-note.ts';

/** #465: "Create '<name>'" after `[[` in the editor. Fictional names only. */

function hook(createNote: ReturnType<typeof fakeVaultFs>['createNote']) {
  const onChanged = vi.fn();
  const onProblem = vi.fn();
  const { result } = renderHook(() =>
    useCreateLinkedNote({
      fs: fakeVaultFs({ createNote }),
      markdown: fakeMarkdown(),
      notePaths: [createVaultPath('Plans/Offsite.md')],
      beside: createVaultPath('Plans/Offsite.md'),
      onChanged,
      onProblem,
    }),
  );
  return { create: result.current, onChanged, onProblem };
}

describe('useCreateLinkedNote', () => {
  it('makes a blank note of the name beside the note in view, and says the vault changed', async () => {
    const createNote = vi.fn(async () => 0);
    const { create, onChanged, onProblem } = hook(createNote);
    await create('Mara Quill');
    expect(createNote).toHaveBeenCalledOnce();
    expect(JSON.stringify(createNote.mock.calls[0])).toContain('Plans/Mara Quill.md');
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onProblem).not.toHaveBeenCalled();
  });

  it('says why a note could not be made, and passes the refusal on', async () => {
    const { create, onChanged, onProblem } = hook(async () => {
      throw new Error('The disk is full.');
    });
    await expect(create('Mara Quill')).rejects.toThrow('The disk is full.');
    expect(onProblem).toHaveBeenCalledWith('“Mara Quill” could not be made: The disk is full.');
    expect(onChanged).not.toHaveBeenCalled();
  });
});
