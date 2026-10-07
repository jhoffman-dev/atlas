import { useId, useState, type FormEvent } from 'react';
import type { TagRenamePlan } from '@atlas/application';
import { formatTag, tagKey } from '@atlas/domain';

/** Where renaming the chosen tag has got to. */
export type TagRenameState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'planned'; readonly plan: TagRenamePlan }
  | { readonly kind: 'renaming'; readonly plan: TagRenamePlan };

export interface TagRenameControls {
  readonly state: TagRenameState;
  /** Works out what renaming to what was typed would change, writing nothing. */
  readonly onPreview: (typed: string) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Renaming a tag, in two steps: the new name, then what it would change —
 * every note it touches, with how many uses — before anything is written. A
 * name another tag already has merges the two, and says so on the button.
 */
export function TagRenameForm({
  name,
  rename,
  onClose,
}: {
  name: string;
  rename: TagRenameControls;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState(name);
  const inputId = useId();
  const { state } = rename;
  const plan = state.kind === 'planned' || state.kind === 'renaming' ? state.plan : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (plan === null) rename.onPreview(typed);
    else rename.onConfirm();
  };

  return (
    <form className="tag-rename" aria-label={`Rename ${formatTag(name)}`} onSubmit={submit}>
      <label className="tag-rename__label" htmlFor={inputId}>
        New name
      </label>
      <div className="tag-rename__row">
        <span className="tag-rename__hash" aria-hidden="true">
          #
        </span>
        <input
          id={inputId}
          className="tag-rename__input"
          value={typed}
          // A new name needs a new preview.
          onChange={(event) => {
            setTyped(event.target.value);
            if (plan !== null || state.kind === 'refused') rename.onCancel();
          }}
          autoFocus
          spellCheck={false}
        />
      </div>
      {state.kind === 'refused' && (
        <p className="tag-rename__problem" role="alert">
          {state.message}
        </p>
      )}
      {plan !== null && <RenamePreview plan={plan} />}
      <div className="tag-rename__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            rename.onCancel();
            onClose();
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={state.kind === 'checking' || state.kind === 'renaming' || plan?.total === 0}
        >
          {actionLabel(plan)}
        </button>
      </div>
    </form>
  );
}

function actionLabel(plan: TagRenamePlan | null): string {
  if (plan === null) return 'Preview';
  if (plan.mergesInto !== null) return `Merge into ${formatTag(plan.mergesInto)}`;
  return `Rename ${count(plan.total, 'use', 'uses')}`;
}

/** Why a rename would change nothing: every use already reads so, or none is left. */
function unchangedSummary(plan: TagRenamePlan): string {
  const { from, to } = plan.rename;
  return tagKey(from) === tagKey(to)
    ? `Every use is already written ${formatTag(to)}.`
    : 'No note uses it any more.';
}

function RenamePreview({ plan }: { plan: TagRenamePlan }) {
  return (
    <div className="tag-rename__preview" aria-label="Files that will change">
      {plan.mergesInto !== null && (
        <p className="tag-rename__merge" role="alert">
          {formatTag(plan.mergesInto)} is already a tag. Its notes and these will share one tag.
        </p>
      )}
      <p className="tag-rename__summary">
        {plan.total === 0
          ? unchangedSummary(plan)
          : `${count(plan.total, 'use', 'uses')} in ${count(plan.notes.length, 'note', 'notes')} will become ${formatTag(plan.rename.to)}:`}
      </p>
      <ul className="tag-rename__files">
        {plan.notes.map((note) => (
          <li key={note.path} className="tag-rename__file">
            <span className="tag-rename__file-name">{note.path}</span>
            <span className="tags__count">{note.count}</span>
          </li>
        ))}
      </ul>
      {plan.refused.length > 0 && (
        <p className="tag-rename__summary" role="note">
          {`${count(plan.refused.length, 'note keeps', 'notes keep')} ${formatTag(plan.rename.from)}: `}
          {plan.refused.map(({ path, reason }) => `${path} (${reason})`).join(', ')}
        </p>
      )}
    </div>
  );
}
