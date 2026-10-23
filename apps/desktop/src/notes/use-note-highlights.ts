import { useCallback, useMemo } from 'react';
import {
  editHighlightComment,
  literatureHighlightReader,
  type MarkdownPort,
  type OpenNote,
  type OpenNotes,
  type VaultFsPort,
} from '@dfai/application';
import type { VaultPath } from '@dfai/domain';
import type { NoteHighlights } from '@dfai/ui';

/**
 * A literature note's highlights as its pane draws them (#523): each quote
 * block that is a highlight shown as its quote and comment, and a comment
 * typed in place written by `editHighlightComment` — the literature note's
 * own write, byte-preserving, `%%`-escaped and read back before it lands.
 * The pane's typing is written first, as Make task does, so the comment is
 * written over the note as it is on screen; typing that comes in meanwhile
 * has the write refused, and the field says so. Null for any other note.
 */
export function useNoteHighlights({
  fs,
  markdown,
  openNotes,
  flush,
  path,
  open,
  onChanged,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: OpenNotes;
  /** Writes the pane's unsaved typing, settling once it has landed or been refused. */
  flush: () => Promise<void>;
  path: VaultPath | null;
  open: OpenNote | null;
  /** Re-reads the tree and the index, after a comment was written. */
  onChanged: () => void;
}): NoteHighlights | null {
  const viewOf = useMemo(
    () =>
      open === null
        ? null
        : literatureHighlightReader(markdown, { properties: open.properties, text: open.onDisk }),
    [markdown, open],
  );
  const editComment = useCallback(
    async ({ id, comment }: { id: string; comment: string }) => {
      if (path === null) throw new Error('No note is open to write the comment to.');
      await flush();
      await editHighlightComment({ fs, markdown, openNotes }, { path, id, comment });
      onChanged();
    },
    [fs, markdown, openNotes, flush, path, onChanged],
  );
  return useMemo(() => (viewOf === null ? null : { viewOf, editComment }), [viewOf, editComment]);
}
