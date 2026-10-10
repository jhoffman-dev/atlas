import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ObjectType, VaultPath } from '@atlas/domain';
import {
  addTerm,
  loadTerms,
  setTermVariants,
  termVariantsChange,
  type IndexPort,
  type MarkdownPort,
  type NoteTemplate,
  type TermsCatalog,
  type VaultFsPort,
} from '@atlas/application';
import type { NewTerm, TermsPageProps } from '@atlas/ui';
import type { OpenEditors } from '../panes/open-editors.ts';

/** What the Terms page reads and writes through: the index, the files, and the panes. */
export interface TermsPagePorts {
  readonly index: Pick<IndexPort, 'query'>;
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly editors: Pick<OpenEditors, 'setPropertiesIfOpen'>;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * The Terms page: the terms and the vocabulary, read while the page is open
 * and again whenever the index changes, and the two things it writes — a new
 * term, and a term's variants. Each is a use-case's; this holds what is on
 * screen and says what failed.
 */
export function useTermsPage({
  ports,
  open,
  indexKey,
  types,
  templates,
  notePaths,
  onChanged,
}: {
  ports: TermsPagePorts;
  /** Whether the page is showing, which is when it is read. */
  open: boolean;
  /** Changes when the index does, so the page lists what it now holds. */
  indexKey: string;
  types: readonly ObjectType[];
  templates: readonly NoteTemplate[];
  notePaths: readonly VaultPath[];
  /** Re-reads the tree and the index once a term was written. */
  onChanged: () => void;
}) {
  const { index, fs, markdown, editors } = ports;
  const [catalog, setCatalog] = useState<TermsCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    loadTerms({ index })
      .then((read) => {
        if (!current) return;
        setCatalog(read);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (current) setError(messageOf(cause));
      });
    return () => {
      current = false;
    };
  }, [index, indexKey, open]);

  /** Runs a write, and says why when it fails rather than letting it vanish. */
  const run = useCallback(
    (work: Promise<unknown>, failed: string) =>
      work.then(
        () => {
          setNotice(null);
          onChanged();
        },
        (cause: unknown) => setNotice(`${failed}: ${messageOf(cause)}`),
      ),
    [onChanged],
  );

  const onAdd = useCallback(
    (term: NewTerm) => {
      void run(
        addTerm({ fs, markdown, term, types, templates, notePaths }),
        `“${term.canonical}” was not added`,
      );
    },
    [run, fs, markdown, types, templates, notePaths],
  );

  const onEditVariants = useCallback(
    ({ path, variants }: { path: VaultPath; variants: string }) => {
      // Through the pane holding the term, when one does: writing the file
      // underneath it would leave its next save to be refused.
      const write = editors
        .setPropertiesIfOpen({ path, values: termVariantsChange(variants) })
        .then((takenByAPane) =>
          takenByAPane ? undefined : setTermVariants({ fs, markdown, path, variants }),
        );
      void run(write, 'The variants could not be saved');
    },
    [run, editors, fs, markdown],
  );

  const page = useMemo<Pick<TermsPageProps, 'contents' | 'error' | 'onAdd' | 'onEditVariants'>>(
    () => ({
      contents:
        catalog === null
          ? null
          : {
              terms: catalog.terms,
              conflicts: catalog.vocabulary.conflicts,
              spellings: catalog.vocabulary.entries.length,
            },
      error,
      onAdd,
      onEditVariants,
    }),
    [catalog, error, onAdd, onEditVariants],
  );

  return { page, notice };
}
