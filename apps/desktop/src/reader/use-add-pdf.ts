import { useCallback, useState } from 'react';
import { addPdfToLibrary, type AddedPdf, type VaultFsPort } from '@dfai/application';
import { libraryFolder, type ObjectType, type VaultPath } from '@dfai/domain';

/*
 * Adding PDFs from the dialog (#504): each file dropped or picked is copied
 * into the library and given its literature note, one after another, and
 * the first one added opens in the reader. pdf.js, which reads the PDF's
 * title, is loaded only when the first PDF is added.
 */

export interface AddPdfState {
  readonly folder: VaultPath;
  readonly adding: boolean;
  readonly error: string | null;
  readonly add: (files: readonly File[]) => Promise<void>;
  readonly reset: () => void;
}

export function useAddPdf({
  fs,
  types,
  today,
  onAdded,
}: {
  fs: VaultFsPort;
  types: readonly Pick<ObjectType, 'name' | 'folder'>[];
  today: () => string;
  /**
   * Told of what was added once all of it is in, and whether every file was:
   * the tree is read again, and the first opened when nothing was refused.
   */
  onAdded: (outcome: { added: readonly AddedPdf[]; allAdded: boolean }) => void;
}): AddPdfState {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folder = libraryFolder({ types, today: today() });
  const add = useCallback(
    async (files: readonly File[]) => {
      setAdding(true);
      setError(null);
      const added: AddedPdf[] = [];
      const refused: string[] = [];
      try {
        // Loading pdf.js can fail (the chunk missing, a flaky disk): that is said, and the dialog is usable again.
        const { appPdfReader } = await import('./app-pdf-reader.ts');
        for (const file of files) {
          try {
            added.push(
              await addPdfToLibrary({ fs, reader: appPdfReader }, { pdf: pickedPdf(file), folder }),
            );
          } catch (failure) {
            refused.push(messageOf(failure));
          }
        }
      } catch (failure) {
        refused.push(`The PDF reader could not be loaded: ${messageOf(failure)}`);
      } finally {
        setAdding(false);
      }
      setError(refused.length === 0 ? null : refused.join(' '));
      if (added.length > 0) onAdded({ added, allAdded: refused.length === 0 });
    },
    [fs, folder, onAdded],
  );
  return { folder, adding, error, add, reset: () => setError(null) };
}

const pickedPdf = (file: File) => ({
  name: file.name,
  size: file.size,
  bytes: async () => new Uint8Array(await file.arrayBuffer()),
});

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
