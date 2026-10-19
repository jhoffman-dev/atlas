import { useEffect, useMemo, useState } from 'react';
import { noteTitle, pageTitle, type VaultPath } from '@atlas/domain';
import { openNote, TaskRuleRefusedError, type OpenNote } from '@atlas/application';
import { PropertiesPane, type OpenHow } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import type { PaneContext } from '../panes/note-pane-container.tsx';
import { writeNoteProperties } from '../query/use-view-writes.ts';
import { useNoteProperties } from '../types/use-note-properties.ts';

/** What a focused row's note is read and written with, and how it is opened. */
export interface RowPorts {
  /** The panes' shared context: the ports, the types, and the index's news. */
  readonly pane: PaneContext;
  readonly openNote: (path: VaultPath, how?: OpenHow) => void;
}

/**
 * The aside's Properties for a table's focused row: the note read by its
 * path — not the table's values, which are only the view's columns — and
 * written as a cell edit is, through the pane holding the note when one
 * does. Read again as the index has news, which is how a write of its own
 * comes back. The table is not drawn for any of it: it told the row's path
 * once, through its steady look.
 */
export function RowAside({ path, ports }: { path: VaultPath; ports: RowPorts }) {
  const { pane, openNote: open } = ports;
  const note = useRowNote({ path, pane });
  const { notes, types, index, notePaths } = pane;
  // Steady, as the pane's own is: the hook reads the links again when it changes.
  const links = useMemo(
    () => ({ fs: notes.fs, markdown: notes.markdown, notePaths }),
    [notes.fs, notes.markdown, notePaths],
  );
  const properties = useNoteProperties({ note, types, index, links });
  if (note === null) return <p className="aside__empty">Reading…</p>;
  const title = pageTitle({ fileTitle: noteTitle(path), properties: note.properties }).text;
  return (
    <PropertiesPane
      context={`${properties.typeLabel ?? 'Note'} · selected row`}
      title={title}
      path={path}
      typeName={properties.typeName}
      typeLabel={properties.typeLabel}
      rows={properties.rows}
      relationChoices={properties.relationChoices}
      relationTargets={properties.relationTargets}
      fileKeys={properties.keys}
      onChange={(key, value) => writeRowProperty({ pane, path, key, value })}
      onOpenNote={(target) => open(target)}
      onOpen={() => open(path)}
      onOpenInNewTab={() => open(path, 'new-tab')}
    />
  );
}

/** The row's note, read afresh as the index reports a change; null until read. */
function useRowNote({ path, pane }: { path: VaultPath; pane: PaneContext }): OpenNote | null {
  const { notes, indexKey } = pane;
  const [note, setNote] = useState<OpenNote | null>(null);
  useEffect(() => {
    let current = true;
    openNote({ fs: notes.fs, markdown: notes.markdown, path })
      .then((read) => {
        if (current) setNote(read);
      })
      .catch(() => {
        // Safe to ignore: a row whose note has gone from under it shows
        // nothing, and the table drops the row once the index catches up.
        if (current) setNote(null);
      });
    return () => {
      current = false;
    };
  }, [notes, path, indexKey]);
  return note;
}

function writeRowProperty({
  pane,
  path,
  key,
  value,
}: {
  pane: PaneContext;
  path: VaultPath;
  key: string;
  value: unknown;
}): void {
  const { notes, editors, activity, onChanged } = pane;
  const write = { activity, write: 'edit', path, refusal: TaskRuleRefusedError } as const;
  void withGiveUpRecorded(write, () =>
    writeNoteProperties({
      editors,
      fs: notes.fs,
      markdown: notes.markdown,
      path,
      values: { [key]: value },
    }),
  )
    .then(onChanged)
    .catch(() => {
      // Said in Activity by `withGiveUpRecorded`; the row keeps its old value
      // on screen, which is what the file still holds.
    });
}
