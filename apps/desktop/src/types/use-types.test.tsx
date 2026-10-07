// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import { fakeVaultFs, type NoteFile } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useTypes } from './use-types.ts';

const typeFile = (label: string): NoteFile => ({
  path: '.atlas/types/task.md',
  text: `---\nname: task\nlabel: ${label}\n---\n`,
  modified: 1,
  size: 1,
});

describe('useTypes', () => {
  it('keeps the latest load when an older one finishes after it', async () => {
    // A save reloads the types, and so does the index moving on: two loads in
    // flight, and the one that read the file before the save can land last.
    const reads: ((files: NoteFile[]) => void)[] = [];
    const fs = fakeVaultFs({
      listDirectory: async () => [
        { kind: 'file', name: 'task.md', path: createVaultPath('.atlas/types/task.md') },
      ],
      readNotes: () => new Promise((resolve) => reads.push(resolve)),
    });
    const hook = renderHook(() =>
      useTypes({ fs, markdown: remarkMarkdown, vaultKey: '/vault', changeKey: 'a' }),
    );
    await waitFor(() => expect(reads).toHaveLength(1));
    act(() => hook.result.current.reload());
    await waitFor(() => expect(reads).toHaveLength(2));

    await act(async () => reads[1]?.([typeFile('After the save')]));
    await act(async () => reads[0]?.([typeFile('Before the save')]));

    expect(hook.result.current.types.map((type) => type.label)).toEqual(['After the save']);
    expect(hook.result.current.types[0]?.path).toBe('.atlas/types/task.md');
  });
});
