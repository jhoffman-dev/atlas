import { useEffect, useMemo, useState } from 'react';
import { parentVaultPath, vaultPathName, type VaultPath } from '@dfai/domain';
import type { PdfOutlineEntry } from '@dfai/application';
import { PdfReader, type ReaderPageSize, type ReaderReveal } from '@dfai/ui';
import type { PdfJsDocument } from '@dfai/adapters/pdf';
import { PageFrameFallback, type PageChrome } from '../page-frame-fallback.tsx';
import { appPdfReader } from './app-pdf-reader.ts';
import {
  useLiteratureNoteOf,
  usePlacedHighlights,
  useReaderWrites,
  type DocumentPorts,
} from './use-document-highlights.ts';
import { useOpenPdf } from './use-open-pdf.ts';

/*
 * A PDF in a reader tab (#504), in the chunk that brings pdf.js, loaded the
 * first time a PDF opens. It opens the file, finds its literature note, and
 * hands the reader the note's highlights placed on the pages and the writes
 * its marks make.
 */

export interface DocumentReaderProps extends PageChrome {
  readonly path: VaultPath;
  readonly vault: string;
  readonly ports: DocumentPorts;
  /** The highlight asked to be shown, by id, once per ask. */
  readonly reveal: ReaderReveal | null;
  readonly onOpenNote: (path: VaultPath) => void;
}

export function DocumentReader(props: DocumentReaderProps) {
  const open = useOpenPdf({ fs: props.ports.fs, reader: appPdfReader, path: props.path });
  const chrome = {
    ...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar }),
    ...(props.history !== undefined && { history: props.history }),
  };
  if (open.state !== 'open') {
    return (
      <PageFrameFallback {...chrome}>
        {open.state === 'failed' ? (
          <p className="notice pdf-reader__notice" role="alert">
            {open.message}
          </p>
        ) : (
          <p className="pdf-reader__opening">Opening {vaultPathName(props.path)}…</p>
        )}
      </PageFrameFallback>
    );
  }
  return <OpenDocument {...props} document={open.document} generation={open.generation} />;
}

function OpenDocument(
  props: DocumentReaderProps & { document: PdfJsDocument; generation: number },
) {
  const { ports, vault, path, document, generation } = props;
  // Undefined while it is looked for: not yet "no note", so nothing is said and nothing marked.
  const found = useLiteratureNoteOf({ ports, vault, pdf: path });
  const note = found ?? null;
  const highlights = usePlacedHighlights({ ports, vault, note, document, generation });
  const { actions, notice } = useReaderWrites({ ports, vault, note, pdf: path, document });
  const firstPageSize = useFirstPageSize(document);
  const outline = useOutline(document);
  const shownDocument = useMemo(
    () => ({
      pageCount: document.pageCount,
      pageSize: (page: number) => document.pageSize(page),
      pageText: (page: number) => document.pageText(page),
      drawPage: document.drawPage,
    }),
    [document],
  );
  if (firstPageSize === null) return null;
  return (
    <PdfReader
      {...actions}
      title={vaultPathName(path)}
      folder={parentVaultPath(path) || 'Vault'}
      document={shownDocument}
      firstPageSize={firstPageSize}
      outline={outline}
      highlights={highlights}
      reveal={props.reveal}
      notice={notice ?? (found === null ? NO_NOTE : null)}
      onOpenNote={note === null ? null : () => props.onOpenNote(note)}
      {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
      {...(props.history !== undefined && { history: props.history })}
    />
  );
}

/** Said over a PDF no literature note names: it can be read, but highlights have nowhere to go. */
const NO_NOTE =
  'This PDF has no literature note, so highlights cannot be kept. Add it with “Add PDF…” in ⌘K to make one.';

/** US Letter, for the moment before the first page's own size is read. */
const LETTER: ReaderPageSize = { width: 612, height: 792 };

function useFirstPageSize(document: PdfJsDocument): ReaderPageSize | null {
  const [size, setSize] = useState<ReaderPageSize | null>(null);
  useEffect(() => {
    let live = true;
    document.pageSize(1).then(
      (read) => live && setSize(read),
      // A first page that cannot be measured is drawn as a Letter page: it still reads.
      () => live && setSize(LETTER),
    );
    return () => {
      live = false;
    };
  }, [document]);
  return size;
}

function useOutline(document: PdfJsDocument): readonly PdfOutlineEntry[] | null {
  const [outline, setOutline] = useState<readonly PdfOutlineEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    document.outline().then(
      (read) => live && setOutline(read),
      // An outline that cannot be read is shown as none: the pages are still there to go to.
      () => live && setOutline([]),
    );
    return () => {
      live = false;
    };
  }, [document]);
  return outline;
}
