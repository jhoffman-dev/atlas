import { useState } from 'react';
import { isImeKey } from './ime.ts';

/**
 * A text field that says what it holds only when you are done with it: on
 * Enter, or on leaving it. Escape puts back what it held; an unchanged value
 * commits nothing. For names in an editor, where every keystroke must not be
 * a write.
 */
export function CommitField({
  value,
  label,
  onCommit,
  className = 'type-editor__field',
  placeholder,
  disabled = false,
}: {
  value: string;
  /** The field's accessible name. */
  label: string;
  onCommit: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // What was last handed over, so Enter and then leaving the field is one
  // commit, not two, while the change is still on its way back as `value`.
  const [sent, setSent] = useState(value);
  // A value changed from outside — a save landing, an undo — replaces the
  // draft. Adjusted while rendering, as React advises, rather than in an effect.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
    setSent(value);
  }

  const commit = () => {
    const next = draft.trim();
    if (next === value || next === sent) return;
    setSent(next);
    onCommit(next);
  };

  return (
    <input
      className={className}
      type="text"
      aria-label={label}
      value={draft}
      disabled={disabled}
      {...(placeholder !== undefined && { placeholder })}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isImeKey(event)) return;
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(value);
        }
      }}
    />
  );
}
