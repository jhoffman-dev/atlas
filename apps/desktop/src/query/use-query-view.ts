import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseQueryView,
  queryViewLayout,
  queryViewSummary,
  queryViewTabs,
  QUERY_VIEW_KEY,
  queryViewSaveProblem,
  type ObjectType,
  type QueryViewSummary,
  type SidebarEntry,
  type ViewLayout,
  type ViewTab,
} from '@atlas/domain';
import type { OpenNote } from '@atlas/application';
import { useNoteNames, type AtlasQueryPanelProps, type GroupFolds } from '@atlas/ui';
import { errorMessage } from './error-message.ts';
import { resultFor, useAtlasQuery } from './use-atlas-query.ts';
import { useQueryChoices } from './use-query-choices.ts';
import { QUERY_LAYOUT_CHOICES, useQueryKeeping } from './use-query-keeping.ts';
import type { QueryPagePorts } from './use-query-page.ts';
import { writeNoteProperties } from './use-view-writes.ts';

export interface QueryViewState {
  readonly tabs: readonly ViewTab[];
  readonly panel: Omit<AtlasQueryPanelProps, 'popups' | 'pending'>;
  /** Whether the query or its layout differs from the file. */
  readonly edited: boolean;
  readonly save: () => void;
  /** Keeps the view as shown in a new view note, leaving this one as it was. */
  readonly saveAs: (name: string) => void;
  readonly reset: () => void;
  /** Why the last save, or save as new, was refused. */
  readonly saveError: string | null;
  /** What a new view's name starts as: this one's, marked as a copy. */
  readonly suggestedName: string;
}

/**
 * The open note when it is a saved Atlas query (P24-04): its query, edited in
 * the builder or as text, and its answer in the layout it keeps. Edits are
 * the view's until saved; Save writes the `query` and `layout` keys and
 * nothing else, so the rest of the file is left as it was written.
 */
export function useQueryView({
  note,
  ports,
  types,
  notePaths,
  indexKey,
  queryViews,
  dashboards,
  viewPaths,
  onChanged,
  onOpenNote,
  folds,
}: {
  note: OpenNote | null;
  ports: QueryPagePorts;
  /** Which groups are folded shut, remembered for this view on this Mac. */
  folds: GroupFolds;
  types: readonly ObjectType[];
  notePaths: readonly string[];
  indexKey: string;
  /** Every saved query, for the tabs. */
  queryViews: readonly QueryViewSummary[];
  dashboards: readonly SidebarEntry[];
  /** Every view note, so a new one's name is checked against them. */
  viewPaths: readonly string[];
  onChanged: () => void;
  onOpenNote: (path: string) => void;
}): QueryViewState | null {
  const saved = useMemo(() => savedOf(note), [note]);
  const editor = useAtlasQuery({
    initialText: saved?.text ?? '',
    index: ports.index,
    types,
    notePaths,
    indexKey,
    enabled: saved !== null,
  });
  const [layout, setLayout] = useState<ViewLayout>(saved?.layout ?? 'table');
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The text this view last wrote, so the file coming back with it is not a change. */
  const written = useRef<string | null>(null);
  useReloadOnSave({ saved, load: editor.load, setLayout, written });

  const choices = useQueryChoices({
    index: ports.index,
    types,
    // A note that is not a query asks for nothing to pick from.
    fields: saved === null ? NO_FIELDS : editor.fields,
    notePaths,
    indexKey,
  });
  const keeping = useQueryKeeping({
    ports,
    text: editor.text,
    viewPaths,
    dashboards,
    onSavedView: onOpenNote,
    onChanged,
  });
  const names = useNoteNames();
  const path = note?.path ?? null;
  const text = editor.text;

  const save = useCallback(() => {
    if (path === null) return;
    const problem = queryViewSaveProblem(text);
    if (problem !== null) {
      setSaveError(problem);
      return;
    }
    const values = { [QUERY_VIEW_KEY]: text, layout };
    written.current = text;
    const { editors, fs, markdown } = ports;
    writeNoteProperties({ editors, fs, markdown, path, values })
      .then(() => {
        setSaveError(null);
        onChanged();
      })
      .catch((cause: unknown) => setSaveError(errorMessage(cause)));
  }, [ports, path, text, layout, onChanged]);

  if (saved === null || note === null) return null;
  const result = resultFor({ answer: editor.answer, layout, names });
  return {
    tabs: queryViewTabs({ views: queryViews, current: saved.summary }),
    panel: {
      composer: {
        mode: editor.mode,
        onMode: editor.setMode,
        text: editor.text,
        onTextChange: editor.setText,
        problem: editor.problem,
        onRun: editor.rerun,
        builder: editor.builder,
        onBuilderChange: editor.setBuilder,
        textOnly: editor.textOnly,
        choices: {
          types: choices.typeChoices,
          fields: editor.fields,
          valueChoices: choices.valueChoices,
        },
      },
      layout,
      layouts: QUERY_LAYOUT_CHOICES,
      onLayout: setLayout,
      result:
        result === null
          ? null
          : {
              ...result,
              collapsed: folds.collapsed,
              onToggleGroup: folds.onToggle,
              onOpenNote,
            },
      truncated: editor.answer?.result.truncated ?? false,
      error: editor.error,
      dashboards: keeping.dashboards,
    },
    edited: editor.text !== saved.text || layout !== saved.layout,
    save,
    saveAs: (name) => keeping.save.onSave({ name, layout }),
    reset: () => {
      editor.load(saved.text);
      setLayout(saved.layout);
    },
    saveError: saveError ?? keeping.save.error,
    suggestedName: `${saved.summary.title} copy`,
  };
}

const NO_FIELDS: readonly never[] = [];

interface SavedQuery {
  readonly text: string;
  readonly layout: ViewLayout;
  readonly summary: QueryViewSummary;
}

function savedOf(note: OpenNote | null): SavedQuery | null {
  if (note === null) return null;
  const text = parseQueryView(note.properties);
  const summary = queryViewSummary(note.path, note.properties);
  if (text === null || summary === null) return null;
  return { text, layout: queryViewLayout(note.properties), summary };
}

/** A file that changes — saved here, or edited elsewhere — is what the view shows next. */
function useReloadOnSave({
  saved,
  load,
  setLayout,
  written,
}: {
  saved: SavedQuery | null;
  load: (text: string) => void;
  setLayout: (layout: ViewLayout) => void;
  written: { current: string | null };
}) {
  const text = saved?.text ?? null;
  const layout = saved?.layout ?? 'table';
  const path = saved?.summary.path ?? null;
  useEffect(() => {
    if (text === null) return;
    // Our own save coming back: the editor already holds it, as text or as the
    // builder, and may hold more typed since — so it is left as it is.
    if (written.current !== null && text === written.current) {
      written.current = null;
      return;
    }
    load(text);
    setLayout(layout);
  }, [path, text, layout, load, setLayout, written]);
}
