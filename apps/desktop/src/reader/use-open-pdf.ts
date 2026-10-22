import { useEffect, useState } from 'react';
import type { VaultPath } from '@dfai/domain';
import type { VaultFsPort } from '@dfai/application';
import type { PdfJsDocument, PdfJsReader } from '@dfai/adapters/pdf';

/*
 * The PDF a reader tab shows (#504), open for as long as the tab is. An open
 * PDF is pdf.js's, held in its worker, so it is a thing to let go of rather
 * than a read to keep in the query cache (ADR-0040): it is opened when the
 * tab shows the file and closed when the tab goes or moves to another file.
 */

export type OpenPdf =
  | { readonly state: 'opening' }
  | { readonly state: 'open'; readonly opened: PdfJsDocument; readonly generation: number }
  | { readonly state: 'failed'; readonly message: string };

let generations = 0;

export function useOpenPdf({
  fs,
  reader,
  path,
}: {
  fs: Pick<VaultFsPort, 'readBinaryFile'>;
  reader: PdfJsReader;
  path: VaultPath;
}): OpenPdf {
  const [open, setOpen] = useState<OpenPdf>({ state: 'opening' });
  useEffect(() => {
    let live = true;
    let holding: PdfJsDocument | null = null;
    setOpen({ state: 'opening' });
    fs.readBinaryFile(path)
      .then((bytes) => reader.open(new Uint8Array(bytes)))
      .then(
        (opened) => {
          holding = opened;
          if (!live) return void opened.close();
          generations += 1;
          setOpen({ state: 'open', opened, generation: generations });
        },
        (error: unknown) =>
          live &&
          setOpen({ state: 'failed', message: `${path} could not be opened: ${messageOf(error)}` }),
      );
    return () => {
      live = false;
      // Closing is pdf.js letting the worker's copy go; a failure there leaves nothing to tidy.
      void holding?.close().catch(() => undefined);
    };
  }, [fs, reader, path]);
  return open;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
