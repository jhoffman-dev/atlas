import type { ReactNode } from 'react';
import type { QueryFilter, QuerySort, ViewTab } from '@atlas/domain';
import { Icon } from './icon.tsx';
import { FilterPopover, SortPopover, type ViewField } from './view-query-popovers.tsx';
import { ViewTabs, type ViewTabEditing } from './view-tabs.tsx';
import type { OverlaySlots } from './overlay-slot.ts';

export type { ViewField };

export interface ViewToolbarProps {
  /** The saved views over the same type, this one among them. */
  tabs: readonly ViewTab[];
  onOpenView: (path: string) => void;
  /** Given on a type's views: the tabs can be added, renamed, copied, deleted and moved. */
  tabEditing?: ViewTabEditing;
  /** The properties a filter or a sort can name, as their headings read. */
  fields: readonly ViewField[];
  filters: readonly QueryFilter[];
  sorts: readonly QuerySort[];
  onChangeFilters: (filters: readonly QueryFilter[]) => void;
  onChangeSorts: (sorts: readonly QuerySort[]) => void;
  /** What only this layout needs, ahead of Filter — a calendar's month nav. */
  controls?: ReactNode;
  /** The Layout menu, first of the actions: how the view is drawn. */
  layout?: ReactNode;
  /** Save view, Save as new and Reset, while the view differs from its note. */
  pending?: ReactNode;
  /** After Sort: the view's other settings — grouping, which properties show. */
  settings?: ReactNode;
  /** "New task": what the primary button says. */
  newLabel: string;
  onNew: () => void;
  /** Filter's and Sort's open state, when the app holds it (the one-overlay rule). */
  popups?: OverlaySlots;
  /** "Archived": whether the view lists archived notes too; left out, it is not offered. */
  archived?: ArchivedToggle;
  /** "Select": rows can be chosen to act on together; left out, it is not offered. */
  selecting?: SelectToggle;
}

/** Whether a view's rows can be chosen. */
export interface SelectToggle {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}

/** Whether a list shows archived notes as well as the ones in use. */
export interface ArchivedToggle {
  readonly included: boolean;
  readonly onChange: (included: boolean) => void;
}

/**
 * The row under a view's title, as in Board.dc.html: tabs to the other views
 * over the same notes on the left; filtering, sorting and adding on the right.
 * When both will not fit — a calendar's month nav, a narrow split pane — the
 * right-hand group wraps under the tabs rather than squeezing them.
 */
export function ViewToolbar(props: ViewToolbarProps) {
  return (
    <div className="view-toolbar">
      <ViewTabs
        tabs={props.tabs}
        onOpenView={props.onOpenView}
        editing={props.tabEditing}
        popups={props.popups}
      />
      <div className="view-toolbar__actions">
        {props.layout}
        {props.controls}
        {props.pending}
        <FilterPopover
          fields={props.fields}
          filters={props.filters}
          onChange={props.onChangeFilters}
          slot={props.popups?.('filter')}
        />
        <SortPopover
          fields={props.fields}
          sorts={props.sorts}
          onChange={props.onChangeSorts}
          slot={props.popups?.('sort')}
        />
        {props.settings}
        {props.selecting !== undefined && <SelectButton toggle={props.selecting} />}
        {props.archived !== undefined && <ArchivedButton toggle={props.archived} />}
        <button type="button" className="view-toolbar__new" onClick={props.onNew}>
          <Icon name="plus" size={16} />
          {props.newLabel}
        </button>
      </div>
    </div>
  );
}

/** Pressed, the view lists what is archived as well — an unsaved way of looking, like a filter. */
export function ArchivedButton({ toggle }: { toggle: ArchivedToggle }) {
  return (
    <button
      type="button"
      className="view-toolbar__button view-toolbar__archived"
      aria-pressed={toggle.included}
      title={toggle.included ? 'Showing archived notes too' : 'Include archived notes'}
      onClick={() => toggle.onChange(!toggle.included)}
    >
      <Icon name="archive" size={15} />
      Include archived
    </button>
  );
}

/** Pressed, each row leads with a box to choose it by. */
function SelectButton({ toggle }: { toggle: SelectToggle }) {
  return (
    <button
      type="button"
      className="view-toolbar__button view-toolbar__archived"
      aria-pressed={toggle.on}
      onClick={() => toggle.onChange(!toggle.on)}
    >
      <Icon name="task" size={15} />
      Select
    </button>
  );
}
