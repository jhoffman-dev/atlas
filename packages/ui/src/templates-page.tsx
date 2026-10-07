import { useState, type FormEvent } from 'react';
import { TEMPLATES_LABEL, type TemplateUse } from '@atlas/domain';
import { Icon } from './icon.tsx';
import { isImeKey } from './ime.ts';
import { PageBar, type PageHistory } from './page-bar.tsx';
import { PageHead } from './page-head.tsx';
import { lostUsesText, TEMPLATE_EXPLANATION, templateUsesText } from './template-words.ts';

/** A template as the page lists it. */
export interface TemplateListing {
  readonly path: string;
  readonly name: string;
  readonly uses: readonly TemplateUse[];
}

/** A type with no template yet, and what its template would be called. */
export interface TemplateLessType {
  readonly name: string;
  readonly label: string;
  readonly templateName: string;
}

export interface TemplatesPageProps {
  /** Null while the templates folder is being read. */
  catalog: {
    readonly templates: readonly TemplateListing[];
    readonly typesWithout: readonly TemplateLessType[];
  } | null;
  error: string | null;
  /** Why a name cannot be a template's, or null — the domain's rule, handed in. */
  nameProblem: (name: string, except: string | null) => string | null;
  onOpen: (path: string) => void;
  /** Makes a template — for a type when one is named — and opens it. */
  onCreate: (args: { name: string; typeName: string | null }) => void;
  onRename: (args: { path: string; name: string }) => void;
  /** Asks to put the template in the Trash, through the app's usual question. */
  onDelete: (path: string) => void;
  /** Asks to turn the template into one of the vault's notes. */
  onMoveToNotes: (path: string) => void;
  /** What renaming the template at `path` to `name` would stop using it — the domain's rule, handed in. */
  usesLost: (path: string, name: string) => readonly TemplateUse[];
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * Templates: every template in the vault, what each one is used for, and the
 * way to make, open, rename or delete one — the home a template has instead
 * of sitting among the vault's notes (ADR-0026).
 */
export function TemplatesPage(props: TemplatesPageProps) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageBar
        crumb={{ icon: 'template', parent: TEMPLATES_LABEL }}
        name="All templates"
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body">
        <article className="page page--wide templates" aria-label="Templates">
          <PageHead
            icon="template"
            title="Templates"
            description={TEMPLATE_EXPLANATION}
            actions={
              <button
                type="button"
                className="btn btn--primary btn--sm"
                aria-expanded={creating}
                onClick={() => setCreating((was) => !was)}
              >
                <Icon name="plus" size={15} />
                New template
              </button>
            }
          />
          {creating && props.catalog !== null && (
            <NewTemplateForm
              typesWithout={props.catalog.typesWithout}
              nameProblem={props.nameProblem}
              onCreate={(args) => {
                setCreating(false);
                props.onCreate(args);
              }}
              onCancel={() => setCreating(false)}
            />
          )}
          <TemplateList {...props} />
        </article>
      </div>
    </>
  );
}

function NewTemplateForm({
  typesWithout,
  nameProblem,
  onCreate,
  onCancel,
}: {
  typesWithout: readonly TemplateLessType[];
  nameProblem: TemplatesPageProps['nameProblem'];
  onCreate: TemplatesPageProps['onCreate'];
  onCancel: () => void;
}) {
  const [typeName, setTypeName] = useState<string | null>(typesWithout[0]?.name ?? null);
  const [typedName, setTypedName] = useState('');
  const type = typesWithout.find((candidate) => candidate.name === typeName) ?? null;
  // A template serves a type by being called what the type is called, so a
  // type's template takes the type's name rather than one typed over it.
  const name = type === null ? typedName : type.templateName;
  const [tried, setTried] = useState(false);
  const problem = nameProblem(name, null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problem === null) onCreate({ name: name.trim(), typeName });
  };

  return (
    <form className="templates__new" aria-label="New template" onSubmit={submit}>
      <label className="templates__field">
        <span className="templates__label">For</span>
        <span className="select">
          <select
            className="field select__control"
            value={typeName ?? ''}
            onChange={(event) => setTypeName(event.target.value === '' ? null : event.target.value)}
          >
            {typesWithout.map((type) => (
              <option key={type.name} value={type.name}>
                {type.label} notes
              </option>
            ))}
            <option value="">No type — a blank template</option>
          </select>
        </span>
      </label>
      <label className="templates__field templates__field--grow">
        <span className="templates__label">Name</span>
        <input
          className={tried && problem !== null ? 'field field--invalid' : 'field'}
          type="text"
          value={name}
          readOnly={type !== null}
          aria-invalid={tried && problem !== null}
          onChange={(event) => setTypedName(event.target.value)}
        />
      </label>
      {type !== null && (
        <p className="templates__hint">
          Named after the type, so new {type.label} notes start from it.
        </p>
      )}
      <div className="templates__new-actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary btn--sm">
          Create
        </button>
      </div>
      {tried && problem !== null && (
        <p className="templates__problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

function TemplateList({ catalog, error, ...props }: TemplatesPageProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (catalog === null) return <p className="table__empty">Reading the templates…</p>;
  if (catalog.templates.length === 0) {
    return (
      <p className="templates__empty">
        No templates yet. Make one with New template, or choose Edit template on a type.
      </p>
    );
  }
  return (
    <div className="table">
      <div className="table__sheet">
        <table className="table__grid templates__grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Used for</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {catalog.templates.map((template) => (
              <TemplateRow
                key={template.path}
                template={template}
                renaming={renaming === template.path}
                onRenaming={(on) => setRenaming(on ? template.path : null)}
                {...props}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  renaming,
  onRenaming,
  nameProblem,
  onOpen,
  onRename,
  onDelete,
  onMoveToNotes,
  usesLost,
}: Pick<
  TemplatesPageProps,
  'nameProblem' | 'onOpen' | 'onRename' | 'onDelete' | 'onMoveToNotes' | 'usesLost'
> & {
  template: TemplateListing;
  renaming: boolean;
  onRenaming: (on: boolean) => void;
}) {
  return (
    <tr className="table__row">
      <td className="table__name">
        {renaming ? (
          <RenameField
            template={template}
            nameProblem={nameProblem}
            usesLost={usesLost}
            onDone={(name) => {
              onRenaming(false);
              if (name !== null) onRename({ path: template.path, name });
            }}
          />
        ) : (
          <button type="button" className="table__link" onClick={() => onOpen(template.path)}>
            <Icon name="template" size={16} />
            <span className="table__title">{template.name}</span>
          </button>
        )}
      </td>
      <td className="templates__uses">{templateUsesText(template.uses)}</td>
      <td className="templates__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-label={`Edit ${template.name} template`}
          onClick={() => onOpen(template.path)}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-label={`Rename ${template.name} template`}
          onClick={() => onRenaming(true)}
        >
          Rename
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-label={`Move ${template.name} template to notes`}
          onClick={() => onMoveToNotes(template.path)}
        >
          Move to notes…
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm templates__delete"
          aria-label={`Delete ${template.name} template`}
          onClick={() => onDelete(template.path)}
        >
          Delete…
        </button>
      </td>
    </tr>
  );
}

/**
 * A template's name, being changed: Enter or leaving the field renames it,
 * Escape leaves it as it was. A name that cannot be used says why and stays
 * open, so nothing is renamed to it.
 */
function RenameField({
  template,
  nameProblem,
  usesLost,
  onDone,
}: {
  template: TemplateListing;
  nameProblem: TemplatesPageProps['nameProblem'];
  usesLost: TemplatesPageProps['usesLost'];
  /** The new name, or null when nothing is to change. */
  onDone: (name: string | null) => void;
}) {
  const [draft, setDraft] = useState(template.name);
  const problem = nameProblem(draft, template.path);
  const warning = problem === null ? lostUsesText(usesLost(template.path, draft)) : null;
  const commit = () => {
    if (draft.trim() === template.name) onDone(null);
    else if (problem === null) onDone(draft.trim());
  };
  return (
    <span className="templates__rename">
      <input
        className={
          problem === null
            ? 'field templates__rename-input'
            : 'field field--invalid templates__rename-input'
        }
        type="text"
        aria-label={`New name for ${template.name}`}
        aria-invalid={problem !== null}
        // The field opens because Rename was pressed: typing goes straight in.
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (isImeKey(event)) return;
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            event.preventDefault();
            onDone(null);
          }
        }}
      />
      {problem !== null && (
        <span className="templates__problem" role="alert">
          {problem}
        </span>
      )}
      {warning !== null && <span className="templates__warning">{warning}</span>}
    </span>
  );
}
