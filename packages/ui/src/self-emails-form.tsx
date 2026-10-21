import { useCallback, useEffect, useRef, useState } from 'react';

/** The vault owner's own addresses as Settings → Profile draws them. */
export interface SelfEmailsView {
  /** The addresses `selfEmails` keeps, comma-separated; empty for none. */
  readonly kept: string;
  /**
   * Addresses in use from where Settings → Granola kept them before
   * (`granola_self_emails`), while `selfEmails` keeps none; null when there are none.
   */
  readonly inherited: string | null;
  /**
   * Addresses from the person's own Person note, in use while the settings
   * keep none (#226); null when there are none.
   */
  readonly suggested: string | null;
  /** Why the addresses last typed were not saved: some of it is not an address, or the write failed. */
  readonly problem: string | null;
  /** Why the addresses the vault's settings hold could not be read: they are then read as none. */
  readonly unreadable: string | null;
  /** The settings are not read yet, or cannot be: the field cannot be changed. */
  readonly disabled: boolean;
}

/** What the field starts as: what is kept, else what is in use from Granola's key, else the Person note's. */
function shownOf({ kept, inherited, suggested }: SelfEmailsView): string {
  if (kept !== '') return kept;
  return inherited ?? suggested ?? '';
}

/** How long typing rests before what was typed is saved. */
export const SAVE_EMAILS_AFTER_MS = 800;

/** Where the untouched addresses in the field come from: each is in use as it is. */
function originOf({ kept, inherited, suggested }: SelfEmailsView): string | null {
  if (kept !== '') return 'Saved';
  if (inherited !== null) {
    return 'In use from granola_self_emails, where Settings → Granola kept them. Edit them here to keep them here.';
  }
  return suggested === null
    ? null
    : 'In use from your Person note. Type your own here to use those instead.';
}

/** Where the field is with the last addresses typed. */
type Saving = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Your emails: the addresses that are the person in a meeting (ADR-0024
 * amendment). Typed as text and saved as typed (#226): once typing rests,
 * and on leaving the field — no button. The application reads it, writes it,
 * and answers once the write has settled whether it kept them; until then the
 * field holds what was typed, and keeps it when it was not kept, with why.
 * Emptied, the field falls back to what is in use without a saved list.
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
  const [saving, setSaving] = useState<Saving>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Typing waiting for its pause, to be saved: what leaving Settings saves.
  const waiting = useRef<string | null>(null);
  // What was last handed to be saved: the same text twice is one save.
  const sent = useRef<string | null>(null);
  const emails = typed ?? shownOf(view);

  const save = useCallback(
    async (text: string) => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      waiting.current = null;
      if (text === sent.current) return;
      sent.current = text;
      setSaving('saving');
      const kept = await onSave(text);
      if (sent.current !== text) return;
      sent.current = null;
      setSaving(kept ? 'saved' : 'failed');
      // Kept: the field shows what the settings now hold, unless more was typed meanwhile.
      // Refused or failed: what was typed stays, to mend.
      if (kept) setTyped((now) => (now === text ? null : now));
    },
    [onSave],
  );

  // Leaving Settings with typing not yet saved saves it.
  const saveOnLeaving = useRef(save);
  useEffect(() => {
    saveOnLeaving.current = save;
  }, [save]);
  useEffect(
    () => () => {
      if (waiting.current !== null) void saveOnLeaving.current(waiting.current);
    },
    [],
  );

  const change = (text: string) => {
    setTyped(text);
    setSaving('idle');
    waiting.current = text;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(text), SAVE_EMAILS_AFTER_MS);
  };

  return (
    <>
      <p className="settings__lede">
        DFAI knows you in a meeting by these addresses as well as by your name: an attendee at one
        of them is you, and in a Granola meeting you own, “me” is written as <b>You</b>. Put one on
        each line, or separate them with commas; <code>Name &lt;address&gt;</code> works too.
      </p>
      <textarea
        className="field field--block secrets__field profile__emails"
        aria-label="Your emails"
        placeholder={'you@example.com\nMara Quill <another@example.com>'}
        rows={3}
        autoComplete="off"
        spellCheck={false}
        disabled={view.disabled}
        value={emails}
        onChange={(event) => change(event.target.value)}
        onBlur={() => {
          if (typed !== null) void save(typed);
        }}
      />
      <SavingState saving={saving} typed={typed} view={view} />
      {view.unreadable !== null && (
        <p
          className="settings__problem"
          role="alert"
          aria-label="Your emails in settings could not be read"
        >
          {view.unreadable}
        </p>
      )}
    </>
  );
}

/** One quiet line: saving, saved, why it could not be, or where the addresses in use come from. */
function SavingState({
  saving,
  typed,
  view,
}: {
  saving: Saving;
  typed: string | null;
  view: SelfEmailsView;
}) {
  if (saving === 'failed') {
    return (
      <p className="settings__problem" role="alert" aria-label="Your emails were not saved">
        Couldn’t save: {view.problem ?? 'the settings could not be written.'}
      </p>
    );
  }
  const said =
    saving === 'saving'
      ? 'Saving…'
      : saving === 'saved'
        ? 'Saved'
        : typed === null
          ? originOf(view)
          : null;
  return said === null ? null : (
    <p className="settings__status" role="status" aria-label="Where your emails stand">
      {said}
    </p>
  );
}
