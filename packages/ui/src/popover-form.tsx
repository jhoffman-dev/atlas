import type { ReactNode } from 'react';

/**
 * The form inside a toolbar popover: its fields, then one submit button that
 * stays disabled until the fields are ready. Enter submits, as in any form.
 */
export function PopoverForm({
  ready,
  submitLabel,
  onSubmit,
  children,
}: {
  ready: boolean;
  submitLabel: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="view-popover__add"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSubmit();
      }}
    >
      {children}
      <button type="submit" className="view-popover__submit" disabled={!ready}>
        {submitLabel}
      </button>
    </form>
  );
}

/** What the last submit said — where it went, or why it could not — read out as it changes. */
export function Notice({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <p className="view-popover__notice" role="status">
      {text}
    </p>
  );
}
