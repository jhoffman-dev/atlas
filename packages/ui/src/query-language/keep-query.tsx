import { useState } from 'react';
import type { ViewLayout } from '@atlas/domain';
import { ChoiceSelect, type Choice } from '../choice-select.tsx';
import type { OverlaySlot } from '../overlay-slot.ts';
import { Notice, PopoverForm } from '../popover-form.tsx';
import { ToolbarPopover } from '../view-query-popovers.tsx';

export interface SaveQuery {
  readonly layouts: readonly Choice<ViewLayout>[];
  /** Why the last save failed, when it did. */
  readonly error: string | null;
  readonly onSave: (args: { name: string; layout: ViewLayout }) => void;
}

/** "Save as view": a name and a layout, and the query is kept as a view note (P24-04). */
export function SaveQueryPopover({
  save,
  slot,
}: {
  save: SaveQuery;
  slot: OverlaySlot | undefined;
}) {
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<ViewLayout>(save.layouts[0]?.value ?? 'table');
  return (
    <ToolbarPopover icon="plus" label="Save as view" slot={slot}>
      <p className="view-popover__title">Save as view</p>
      <PopoverForm
        ready={name.trim() !== ''}
        submitLabel="Save view"
        onSubmit={() => save.onSave({ name: name.trim(), layout })}
      >
        <input
          aria-label="View name"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <ChoiceSelect label="Layout" value={layout} choices={save.layouts} onChange={setLayout} />
      </PopoverForm>
      <Notice text={save.error} />
    </ToolbarPopover>
  );
}

export interface AddQueryToDashboard {
  readonly choices: readonly Choice[];
  /** What the last add said: where it went, or why it could not. */
  readonly notice: string | null;
  readonly onAdd: (args: { path: string; title: string }) => void;
}

/** "Add to dashboard": the query as a widget that draws its rows in their groups (P24-04). */
export function AddQueryToDashboardPopover({
  dashboards,
  slot,
}: {
  dashboards: AddQueryToDashboard;
  slot: OverlaySlot | undefined;
}) {
  const [path, setPath] = useState(dashboards.choices[0]?.value ?? '');
  const [title, setTitle] = useState('');
  if (dashboards.choices.length === 0) {
    return (
      <ToolbarPopover icon="chart" label="Add to dashboard" slot={slot}>
        <p className="view-popover__empty">There are no dashboards yet.</p>
      </ToolbarPopover>
    );
  }
  return (
    <ToolbarPopover icon="chart" label="Add to dashboard" slot={slot}>
      <p className="view-popover__title">Add to dashboard</p>
      <PopoverForm
        ready={path !== ''}
        submitLabel="Add widget"
        onSubmit={() => dashboards.onAdd({ path, title: title.trim() })}
      >
        <ChoiceSelect
          label="Dashboard"
          value={path}
          choices={dashboards.choices}
          onChange={setPath}
        />
        <input
          aria-label="Widget title"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </PopoverForm>
      <Notice text={dashboards.notice} />
    </ToolbarPopover>
  );
}
