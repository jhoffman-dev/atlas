import { useCallback, useMemo } from 'react';
import {
  createHighlightReadMemo,
  editHighlightComment,
  literatureHighlightReader,
  type MarkdownPort,
  type OpenNote,
  type OpenNotes,
  type VaultFsPort,
} from '@dfai/application';
import { noteTitle, type VaultPath } from '@dfai/domain';
import type { NoteHighlights } from '@dfai/ui';
import type { Toasts } from '../toasts/toasts.ts';

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
  toasts,
  onWritePending,
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
  /** Where words that could not be written as the pane closed are told of. */
  toasts?: Pick<Toasts, 'show'>;
  /** Handed the editor's write of the comments typed and not yet written, for the pane's own flush. */
  onWritePending?: NoteHighlights['onWritePending'];
}): NoteHighlights | null {
  // Kept across readings of the note: its ids are built again only when its highlights change.
  const memo = useMemo(createHighlightReadMemo, [markdown, path]);
  const viewOf = useMemo(
    () =>
      open === null
        ? null
        : literatureHighlightReader(
            markdown,
            { properties: open.properties, text: open.onDisk },
            memo,
          ),
    [markdown, open, memo],
  );
  const editComment = useCallback(
    async ({ id, comment, base }: { id: string; comment: string; base: string }) => {
      if (path === null) throw new Error('No note is open to write the comment to.');
      await flush();
      await editHighlightComment({ fs, markdown, openNotes }, { path, id, comment, base });
      onChanged();
    },
    [fs, markdown, openNotes, flush, path, onChanged],
  );
  const onUnwrittenComments = useMemo(
    () =>
      path === null || toasts === undefined
        ? undefined
        : (lost: readonly { comment: string; why: string }[]) => {
            for (const each of lost) {
              toasts.show({
                message: `Your comment on a highlight in “${noteTitle(path)}” was not saved: ${each.why} It read: “${each.comment}”`,
                tone: 'error',
                action: {
                  label: 'Copy',
                  onClick: () => void navigator.clipboard.writeText(each.comment),
                },
              });
            }
          },
    [path, toasts],
  );
  return useMemo(
    () =>
      viewOf === null
        ? null
        : {
            viewOf,
            editComment,
            ...(onUnwrittenComments !== undefined && { onUnwrittenComments }),
            ...(onWritePending !== undefined && { onWritePending }),
          },
    [viewOf, editComment, onUnwrittenComments, onWritePending],
  );
}
