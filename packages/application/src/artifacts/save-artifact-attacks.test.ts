import { describe, expect, it } from 'vitest';
import { apiFixture } from '../testing/api-fixture.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { saveArtifact } from './save-artifact.ts';

const page = (text: string) => ({ name: 'index.html', bytes: new TextEncoder().encode(text) });

describe('saveArtifact — adversarial', () => {
  it('leaves no orphaned copy behind when the note cannot be written', async () => {
    // The copy is written before the note. When the note then fails — a name the
    // disk refuses, a race for the same name — the folder stays, owned by nothing,
    // and takes the name the next save of the same title would have used.
    const api = apiFixture();
    const { markdown, clock } = api.deps;
    const { fs } = api;
    const refusing = {
      ...fs,
      createNote: async () => {
        throw new VaultAccessError('File name too long');
      },
    };

    await expect(
      saveArtifact({
        fs: refusing,
        markdown,
        clock,
        artifact: { title: 'Launch', files: [page('<p>hi</p>')] },
      }),
    ).rejects.toThrow();

    expect([...api.binaries.keys()]).toEqual([]);
    expect([...api.folders].filter((folder) => folder !== 'artifacts')).toEqual([]);
  });
});
