import type { Widget } from '@atlas/domain';
import type { WidgetResult } from '@atlas/application';
import { ArrangeGrid } from './dashboard/arrange-grid.tsx';
import type { WidgetActions } from './dashboard/widget-frame.tsx';
import { WidgetTile } from './dashboard/widget-tile.tsx';
import type { WidgetPlacement } from './drag/widget-drag.ts';
import type { OverlaySlots } from './overlay-slot.ts';

/**
 * What the dashboard can change about itself, given when its note can be
 * written. Edit and Remove are in every widget's "…"; moving, resizing and
 * adding are for while it is being arranged.
 */
export interface DashboardEditing {
  /** Customize is on: handles on every widget, and a card to add one. */
  readonly arranging: boolean;
  /** Why the last change was not written, if it was not. */
  readonly error: string | null;
  readonly onAdd: () => void;
  readonly onEdit: (widget: Widget) => void;
  readonly onRemove: (widget: Widget) => void;
  readonly onPlace: (placement: WidgetPlacement) => void;
}

/**
 * A dashboard: a twelve-column grid of tiles, each one a query drawn a
 * particular way, each as wide as its widget's `span`.
 *
 * Every tile is drawn independently, including the failed ones, so a widget
 * pointing at a type that no longer exists costs you that tile rather than the
 * page.
 */
export function DashboardView({
  results,
  onOpenNote,
  popups,
  editing,
}: {
  results: readonly WidgetResult[];
  onOpenNote: (path: string) => void;
  /** Each widget menu's open state, when the app holds it (the one-overlay rule). */
  popups?: OverlaySlots;
  editing?: DashboardEditing;
}) {
  const problem =
    editing === undefined || editing.error === null ? null : (
      <p className="dashboard__error" role="alert">
        {editing.error}
      </p>
    );

  if (editing?.arranging === true) {
    return (
      <>
        {problem}
        <ArrangeGrid
          results={results}
          onOpenNote={onOpenNote}
          popups={popups}
          actionsFor={actionsOf(editing)}
          onPlace={editing.onPlace}
          onAdd={editing.onAdd}
          failed={editing.error !== null}
        />
      </>
    );
  }

  if (results.length === 0) {
    return (
      <p className="dashboard__empty">
        This dashboard has no widgets yet.{' '}
        {editing === undefined ? (
          <>
            Add them under <code>widgets:</code> in its properties.
          </>
        ) : (
          'Choose Customize to add one.'
        )}
      </p>
    );
  }

  return (
    <>
      {problem}
      <div className="dashboard" aria-label="Dashboard">
        {results.map((result) => (
          <WidgetTile
            key={result.widget.id}
            result={result}
            onOpenNote={onOpenNote}
            menuSlot={popups?.(`widget-${result.widget.id}`)}
            actions={editing === undefined ? undefined : actionsOf(editing)(result.widget)}
          />
        ))}
      </div>
    </>
  );
}

const actionsOf =
  (editing: DashboardEditing) =>
  (widget: Widget): WidgetActions => ({
    onEdit: () => editing.onEdit(widget),
    onRemove: () => editing.onRemove(widget),
  });
