import { useState, type FormEvent } from 'react';

/** The vault owner's own addresses as Settings → Profile draws them. */
export interface SelfEmailsView {
  /** The addresses `selfEmails` keeps, comma-separated; empty for none. */
  readonly kept: string;
  /**
   * Addresses in use from where Settings → Granola kept them before
   * (`granola_self_emails`), while `selfEmails` keeps none; null when there are none.
   */
  readonly inherited: string | null;
  /** Addresses from the person's own Person note, offered while none are in use; null when there are none. */
  readonly suggested: string | null;
  /** Why the addresses last typed were not saved: some of it is not an address. */
  readonly problem: string | null;
  /** Why the addresses the vault's settings hold could not be read: they are then read as none. */
  readonly unreadable: string | null;
  /** The settings are not read yet, or cannot be: the field cannot be changed. */
  readonly disabled: boolean;
}

/** What the field starts as: what is kept, else what is in use from Granola's key, else the suggestion. */
function shownOf({ kept, inherited, suggested }: SelfEmailsView): string {
  if (kept !== '') return kept;
  return inherited ?? suggested ?? '';
}

/**
 * Whether Save has anything to do: what the field shows differs from what is
 * kept, or the addresses in use are Granola's key's, which saving moves here
 * (or, with the field cleared, removes).
 */
function canSave(emails: string, view: SelfEmailsView): boolean {
  return emails !== view.kept || view.inherited !== null;
}

/** Where untouched addresses in the field come from, when they are not kept here yet. */
function originOf({ kept, inherited, suggested }: SelfEmailsView): string | null {
  if (kept !== '') return null;
  if (inherited !== null) {
    return 'In use from granola_self_emails, where Settings → Granola kept them. Press Save emails to keep them here.';
  }
  return suggested === null ? null : 'From your Person note. Press Save emails to use them.';
}

/**
 * Your emails: the addresses that are the person in a meeting (ADR-0024
 * amendment). Typed as text; the application reads it, writes it, and
 * answers once the write has settled whether it kept them.
 */
export function SelfEmailsForm({
  view,
  onSave,
}: {
  view: SelfEmailsView;
  onSave: (emails: string) => Promise<boolean>;
}) {
  // What the person has typed; null while the field is untouched, which then
  // shows what is kept, in use, or suggested, as each is read.
  const [typed, setTyped] = useState<string | null>(null);
  const emails = typed ?? shownOf(view);
  const origin = typed === null ? originOf(view) : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const sent = emails;
    // Held in the field while the write is under way, whatever the settings are read as meanwhile.
    setTyped(sent);
    const kept = await onSave(sent);
    // Kept: the field shows what the settings now hold, unless more was typed meanwhile.
    // Refused or failed: what was typed stays, to mend or try again.
    if (kept) setTyped((now) => (now === sent ? null : now));
  };

  return (
    <>
      <p className="settings__lede">
        Atlas knows you in a meeting by these addresses as well as by your name: an attendee at one
        of them is you, and in a Granola meeting you own, “me” is written as <b>You</b>. Put one on
        each line, or separate them with commas; <code>Name &lt;address&gt;</code> works too.
      </p>
      <form
        className="secrets__form"
        aria-label="Set your emails"
        onSubmit={(event) => void submit(event)}
      >
        <textarea
          className="field field--block secrets__field profile__emails"
          aria-label="Your emails"
          placeholder={'you@example.com\nMara Quill <another@example.com>'}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          disabled={view.disabled}
          value={emails}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button
          className="btn btn--tinted btn--sm"
          type="submit"
          disabled={view.disabled || !canSave(emails, view)}
        >
          Save emails
        </button>
      </form>
      {origin !== null && <p className="settings__status">{origin}</p>}
      {view.unreadable !== null && (
        <p
          className="settings__problem"
          role="alert"
          aria-label="Your emails in settings could not be read"
        >
          {view.unreadable}
        </p>
      )}
      {view.problem !== null && (
        <p className="settings__problem" role="alert" aria-label="Your emails were not saved">
          {view.problem}
        </p>
      )}
    </>
  );
}
