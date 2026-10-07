import type { ReactNode } from 'react';
import { Icon } from '../icon.tsx';
import { PageBar, type PageHistory } from '../page-bar.tsx';
import { PageHead } from '../page-head.tsx';
import { Toggle } from '../toggle.tsx';
import type { AutomationRow } from './automation-views.ts';

export interface AutomationsPageProps {
  /** Null while the rules are being read. */
  readonly rows: readonly AutomationRow[] | null;
  readonly error: string | null;
  /** The rule open in the editor, by id; null for none. */
  readonly openId: string | null;
  /** The editor, when a rule is open or being made; it sits above the list. */
  readonly editor: ReactNode | null;
  /** The ready-made rules, by name, that "Add" offers. */
  readonly presets: readonly string[];
  readonly onNew: () => void;
  readonly onAddPreset: (name: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onToggle: (id: string, enabled: boolean) => void;
  readonly onRunNow: (id: string) => void;
  /** What the last command did, or why it could not. */
  readonly notice: string | null;
  readonly busy: boolean;
  readonly onShowSidebar?: () => void;
  readonly history?: PageHistory;
}

/**
 * The Automations page (P25-03): every rule — on or off, when it last ran and
 * what it did, when it runs next — with the editor for the one open above
 * them. Ready-made rules are a click from being added.
 */
export function AutomationsPage(props: AutomationsPageProps) {
  const open = props.rows?.find((row) => row.id === props.openId) ?? null;
  return (
    <>
      <PageBar
        crumb={{ icon: 'automation', parent: 'Automations' }}
        name={open?.name ?? (props.editor !== null ? 'New automation' : 'All automations')}
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body">
        <article className="page page--wide automations" aria-label="Automations">
          <PageHead
            icon="automation"
            title="Automations"
            description={describe(props.rows)}
            actions={<Adders {...props} />}
          />
          {props.notice !== null && (
            <p className="automations__notice" role="status">
              {props.notice}
            </p>
          )}
          {props.editor}
          <RuleList {...props} />
        </article>
      </div>
    </>
  );
}

function describe(rows: readonly AutomationRow[] | null): string | null {
  if (rows === null) return null;
  const on = rows.filter((row) => row.enabled && row.problem === null).length;
  const count = `${rows.length} ${rows.length === 1 ? 'automation' : 'automations'}`;
  return `${count}, ${on} on · rules that tidy the vault while you work`;
}

function Adders({ presets, onNew, onAddPreset, busy }: AutomationsPageProps) {
  return (
    <div className="automations__adders">
      {presets.map((name) => (
        <button
          key={name}
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => onAddPreset(name)}
        >
          <Icon name="plus" size={14} />
          {name}
        </button>
      ))}
      <button type="button" className="btn btn--primary" disabled={busy} onClick={onNew}>
        <Icon name="plus" size={14} />
        New automation
      </button>
    </div>
  );
}

function RuleList({ rows, error, openId, onOpen, onToggle, onRunNow, busy }: AutomationsPageProps) {
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (rows === null) return <p className="table__empty">Reading the automations…</p>;
  if (rows.length === 0) {
    return (
      <p className="automations__empty">
        No automations yet. Add the ready-made one above, or make your own.
      </p>
    );
  }
  return (
    <ul className="automations__list" aria-label="All automations">
      {rows.map((row) => (
        <li
          key={row.id}
          className={
            row.id === openId ? 'automation-card automation-card--open' : 'automation-card'
          }
        >
          <Toggle
            label={`Run ${row.name} on its schedule`}
            checked={row.enabled}
            disabled={busy || row.problem !== null}
            onChange={(enabled) => onToggle(row.id, enabled)}
          />
          <div className="automation-card__main">
            <button type="button" className="automation-card__name" onClick={() => onOpen(row.id)}>
              {row.name}
            </button>
            <p className="automation-card__what">
              {row.problem ?? `${row.action} · ${row.schedule}`}
            </p>
            {row.notice !== null && (
              <p className="automation-card__notice" role="status">
                {row.notice}
              </p>
            )}
          </div>
          <dl className="automation-card__times">
            <div>
              <dt>Last run</dt>
              <dd>{row.lastRun ?? 'Never'}</dd>
            </div>
            <div>
              <dt>Next run</dt>
              <dd>{row.nextRun ?? '—'}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label={`Run ${row.name} now`}
            disabled={busy || row.problem !== null}
            onClick={() => onRunNow(row.id)}
          >
            Run now
          </button>
        </li>
      ))}
    </ul>
  );
}
