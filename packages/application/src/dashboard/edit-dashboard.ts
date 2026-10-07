import {
  DASHBOARD_MARKER,
  DASHBOARD_MARKER_VALUE,
  entryFromDraft,
  parseDashboard,
  placeEntry,
  removeEntry,
  replaceEntry,
  widgetEntries,
  type WidgetDraft,
} from '@atlas/domain';
import type { PropertyChanges } from '../query/set-property.ts';
import { runWidget, type WidgetResult } from './run-widget.ts';

/**
 * One change to a dashboard, as the editor asks for it. `entry` is the
 * widget's place in the note's `widgets:` list (`Widget.entry`).
 */
export type DashboardEdit =
  | { readonly kind: 'add'; readonly draft: WidgetDraft }
  | { readonly kind: 'update'; readonly entry: number; readonly draft: WidgetDraft }
  | { readonly kind: 'remove'; readonly entry: number }
  /** Moved to where `to` stood, and at `span` columns — null when the width did not change. */
  | {
      readonly kind: 'place';
      readonly entry: number;
      readonly to: number;
      readonly span: number | null;
    }
  /** The list as it was before an earlier edit — what undo writes back. */
  | { readonly kind: 'restore'; readonly widgets: unknown };

/** The dashboard's `widgets:` after one edit. */
export function applyDashboardEdit(entries: readonly unknown[], edit: DashboardEdit): unknown[] {
  switch (edit.kind) {
    case 'add':
      return [...entries, entryFromDraft(edit.draft)];
    case 'update':
      return replaceEntry(entries, edit.entry, entryFromDraft(edit.draft, entries[edit.entry]));
    case 'remove':
      return removeEntry(entries, edit.entry);
    case 'place':
      return placeEntry(entries, { from: edit.entry, to: edit.to, span: edit.span });
    case 'restore':
      return Array.isArray(edit.widgets) ? [...edit.widgets] : [];
  }
}

/**
 * The edit as a frontmatter write. It is worked out against the note as it is
 * when the write happens, not as it was when the gesture began, so an edit made
 * in another pane a moment earlier is built on rather than written over.
 *
 * Only `widgets` is written; the markdown adapter writes the list into the one
 * already in the file, so the widgets the edit did not touch keep their text.
 */
export function dashboardChange(edit: DashboardEdit): PropertyChanges {
  return (properties) => {
    if (edit.kind === 'restore' && edit.widgets === undefined) return { widgets: null };
    return { widgets: applyDashboardEdit(widgetEntries(properties), edit) };
  };
}

/**
 * Runs a draft as the dashboard would, for the editor's preview. Null when the
 * draft is not yet a widget — the editor says why beside its controls.
 */
export async function previewWidget({
  draft,
  ...run
}: Omit<Parameters<typeof runWidget>[0], 'widget'> & {
  draft: WidgetDraft;
}): Promise<WidgetResult | null> {
  const [widget] = parseDashboard({
    [DASHBOARD_MARKER]: DASHBOARD_MARKER_VALUE,
    widgets: [entryFromDraft(draft)],
  });
  // Run as the dashboard runs it — the vault's types, notes and names — so the
  // preview asks the index what the dashboard will.
  return widget === undefined ? null : runWidget({ ...run, widget });
}
