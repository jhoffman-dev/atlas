import { useRef, useState, type RefObject } from 'react';
import type { QuerySort, SchemaTable, SqlShow, ViewLayout } from '@atlas/domain';
import { ChoiceSelect, type Choice } from './choice-select.tsx';
import { Notice, PopoverForm } from './popover-form.tsx';
import { Icon } from './icon.tsx';
import { isImeKey } from './ime.ts';
import type { OverlaySlot, OverlaySlots } from './overlay-slot.ts';
import { TableView, type TableResult } from './table-view.tsx';
import { ToolbarPopover } from './view-query-popovers.tsx';

/** A choice in one of the page's lists: what is stored, and what is shown. */
export type QueryChoice<Value extends string = string> = Choice<Value>;

export interface QueryPageProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  onRun: () => void;
  running: boolean;
  /** The last run's rows, or null before one has come back. */
  result: TableResult | null;
  /** Why the last run failed, in the index's words. */
  error: string | null;
  sorts: readonly QuerySort[];
  onToggleSort: (column: string) => void;
  onOpenNote: (path: string) => void;
  /** The index's tables and views, or null while they are being read. */
  schema: readonly SchemaTable[] | null;
  save: SaveAsView;
  dashboards: AddToDashboard;
  /** The Save and Add popovers' open state, when the app holds it. */
  popups?: OverlaySlots;
}

export interface SaveAsView {
  readonly layouts: readonly QueryChoice<ViewLayout>[];
  readonly error: string | null;
  readonly onSave: (args: { name: string; layout: ViewLayout }) => void;
}

export interface AddToDashboard {
  readonly choices: readonly QueryChoice[];
  readonly shows: readonly QueryChoice<SqlShow>[];
  /** What the last add said: where it went, or why it could not. */
  readonly notice: string | null;
  readonly onAdd: (args: { path: string; show: SqlShow; title: string }) => void;
}

/**
 * Writing SQL over the index and reading the answer: the statement on the
 * left with the result under it, the index's tables and columns beside it.
 * Only a statement that reads can run; the index refuses anything else.
 */
export function QueryPage(props: QueryPageProps) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const insert = (text: string) =>
    insertAtCursor({ editor, sql: props.sql, text, onChange: props.onSqlChange });
  return (
    <div className="query">
      <section className="query__main" aria-label="Query">
        <SqlEditor
          editor={editor}
          sql={props.sql}
          onChange={props.onSqlChange}
          onRun={props.onRun}
        />
        <QueryActions {...props} />
        <QueryResult {...props} />
      </section>
      <SchemaList schema={props.schema} onInsert={insert} />
    </div>
  );
}

/** Puts `text` where the cursor is — or over the selection — and leaves the cursor after it. */
function insertAtCursor({
  editor,
  sql,
  text,
  onChange,
}: {
  editor: RefObject<HTMLTextAreaElement | null>;
  sql: string;
  text: string;
  onChange: (sql: string) => void;
}) {
  const field = editor.current;
  const start = field?.selectionStart ?? sql.length;
  const end = field?.selectionEnd ?? sql.length;
  onChange(sql.slice(0, start) + text + sql.slice(end));
  requestAnimationFrame(() => {
    field?.focus();
    field?.setSelectionRange(start + text.length, start + text.length);
  });
}

/** A monospace field with its line numbers beside it; Cmd+Enter runs it. */
function SqlEditor({
  editor,
  sql,
  onChange,
  onRun,
}: {
  editor: RefObject<HTMLTextAreaElement | null>;
  sql: string;
  onChange: (sql: string) => void;
  onRun: () => void;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = Math.max(1, sql.split('\n').length);
  return (
    <div className="query__editor">
      <div className="query__gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, at) => (
          <span key={at}>{at + 1}</span>
        ))}
      </div>
      <textarea
        ref={editor}
        className="query__sql"
        aria-label="SQL"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="SELECT title, status FROM v_task WHERE status IS NOT 'done'"
        value={sql}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current !== null) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !isImeKey(event)) {
            event.preventDefault();
            onRun();
          }
        }}
      />
    </div>
  );
}

function QueryActions({ onRun, running, result, save, dashboards, popups }: QueryPageProps) {
  return (
    <div className="query__actions">
      <button type="button" className="btn btn--primary btn--sm" onClick={onRun} disabled={running}>
        {running ? 'Running…' : 'Run'}
        <kbd className="query__key">⌘↵</kbd>
      </button>
      {result !== null && (
        <span className="query__count" role="status">
          {rowCount(result)}
        </span>
      )}
      <span className="query__spacer" />
      {result !== null && (
        <>
          <SaveAsViewPopover save={save} slot={popups?.('save-query')} />
          <AddToDashboardPopover dashboards={dashboards} slot={popups?.('add-query')} />
        </>
      )}
    </div>
  );
}

function rowCount(result: TableResult): string {
  const count = result.rows.length;
  const rows = `${count} ${count === 1 ? 'row' : 'rows'}`;
  return result.truncated ? `${rows} (more were left out)` : rows;
}

function QueryResult({ result, error, sorts, onToggleSort, onOpenNote }: QueryPageProps) {
  if (error !== null) {
    return (
      <p className="query__error" role="alert">
        {error}
      </p>
    );
  }
  if (result === null) {
    return <p className="query__hint">Write a query and run it. Only reading is allowed.</p>;
  }
  return (
    <TableView
      result={result}
      sorts={sorts}
      error={null}
      onOpenNote={onOpenNote}
      onToggleSort={onToggleSort}
    />
  );
}

/** Every table and view, each opening onto its columns; a click puts the name in the query. */
function SchemaList({
  schema,
  onInsert,
}: {
  schema: readonly SchemaTable[] | null;
  onInsert: (text: string) => void;
}) {
  return (
    <aside className="query__schema" aria-label="Tables">
      <p className="query__schema-title">Tables</p>
      {schema === null ? (
        <p className="query__hint">Reading the index…</p>
      ) : (
        <ul className="query__tables">
          {schema.map((table) => (
            <SchemaTableRow key={table.name} table={table} onInsert={onInsert} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function SchemaTableRow({
  table,
  onInsert,
}: {
  table: SchemaTable;
  onInsert: (text: string) => void;
}) {
  return (
    <li className="query__table">
      <details open={table.kind === 'view'}>
        <summary className="query__table-name">
          <Icon name={table.kind === 'view' ? 'table' : 'grid'} size={14} />
          {table.name}
        </summary>
        <button
          type="button"
          className="query__insert"
          aria-label={`Insert ${table.name}`}
          onClick={() => onInsert(table.name)}
        >
          Insert name
        </button>
        <ul className="query__columns">
          {table.columns.map((column) => (
            <li key={column}>
              <button
                type="button"
                className="query__column"
                aria-label={`Insert ${table.name}.${column}`}
                onClick={() => onInsert(column)}
              >
                {column}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function SaveAsViewPopover({ save, slot }: { save: SaveAsView; slot: OverlaySlot | undefined }) {
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<ViewLayout>(save.layouts[0]?.value ?? 'table');
  const problem = save.layouts.find((choice) => choice.value === layout)?.problem ?? null;
  return (
    <ToolbarPopover icon="plus" label="Save as view" slot={slot}>
      <p className="view-popover__title">Save as view</p>
      <PopoverForm
        ready={name.trim() !== '' && problem === null}
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
      <Notice text={problem ?? save.error} />
    </ToolbarPopover>
  );
}

function AddToDashboardPopover({
  dashboards,
  slot,
}: {
  dashboards: AddToDashboard;
  slot: OverlaySlot | undefined;
}) {
  const [path, setPath] = useState(dashboards.choices[0]?.value ?? '');
  const [show, setShow] = useState<SqlShow>('table');
  const [title, setTitle] = useState('');
  const problem = dashboards.shows.find((choice) => choice.value === show)?.problem ?? null;
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
        ready={path !== '' && problem === null}
        submitLabel="Add widget"
        onSubmit={() => dashboards.onAdd({ path, show, title: title.trim() })}
      >
        <ChoiceSelect
          label="Dashboard"
          value={path}
          choices={dashboards.choices}
          onChange={setPath}
        />
        <ChoiceSelect label="Show as" value={show} choices={dashboards.shows} onChange={setShow} />
        <input
          aria-label="Widget title"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </PopoverForm>
      <Notice text={problem ?? dashboards.notice} />
    </ToolbarPopover>
  );
}
