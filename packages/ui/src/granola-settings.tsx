import { useState, type FormEvent } from 'react';
import { SettingsCard } from './settings-card.tsx';

/**
 * What this Mac holds for the vault: being asked; no key; a key; a key
 * Granola has just accepted; a key whose last answer from Granola was a refusal.
 */
export type GranolaKeyState = 'checking' | 'none' | 'set' | 'accepted' | 'refused';

/** A meeting the last pull did not write, and why. Never what it says. */
export interface GranolaNoteLine {
  readonly id: string;
  readonly title: string;
  readonly problem: string;
  /** The meeting in Granola, when Granola named it. */
  readonly url: string | null;
}

/** Settings → Granola as the card draws it. There is no key here to show. */
export interface GranolaView {
  readonly keyState: GranolaKeyState;
  /** True until the vault has synced this session: Atlas does not pull before then. */
  readonly waiting: boolean;
  readonly pulling: boolean;
  /** What the last pull did, in a few words; null before one has finished this session. */
  readonly lastPull: string | null;
  /** When this Mac last finished a pull of the vault, as its clock shows it. */
  readonly lastPullAt: string | null;
  /** The meetings the last pull did not write. */
  readonly notes: readonly GranolaNoteLine[];
  /** The person's own addresses in Granola, as the vault's settings keep them, comma-separated; empty for none. */
  readonly selfEmails: string;
  /** Addresses from the person's own Person note, offered while none are kept; null when there are none. */
  readonly suggestedEmails: string | null;
  readonly problem: string | null;
  /** A key is being saved or forgotten. */
  readonly pending: boolean;
}

const KEY_STATUS: Readonly<Record<GranolaKeyState, string>> = {
  checking: 'Checking…',
  none: 'No key on this Mac',
  set: 'Key set',
  accepted: 'Key accepted',
  refused: 'Granola refused this key',
};

function pullStatus(view: GranolaView): string {
  if (view.pulling) return 'Pulling from Granola…';
  const at = view.lastPullAt === null ? '' : ` at ${view.lastPullAt}`;
  if (view.lastPull !== null) return `${view.lastPull}${at}`;
  return view.lastPullAt === null ? 'Not pulled on this Mac yet' : `Last pulled${at}`;
}

/**
 * Settings → Granola: the API key Atlas asks Granola with, and Sync now.
 * The key is typed into a masked field and handed on; the field is emptied
 * as it goes, and nothing on this card ever holds a key to show.
 */
export function GranolaSettings({
  view,
  onSaveKey,
  onForgetKey,
  onSyncNow,
  onOpenNote,
  onSaveEmails,
}: {
  view: GranolaView;
  onSaveKey: (key: string) => void;
  /** The addresses as typed; the application reads them. */
  onSaveEmails: (emails: string) => void;
  onForgetKey: () => void;
  onSyncNow: () => void;
  onOpenNote: (url: string) => void;
}) {
  const hasKey = view.keyState !== 'none' && view.keyState !== 'checking';
  return (
    <SettingsCard id="settings-granola" icon="event" title="Granola">
      <p className="settings__lede">
        Meetings you record in Granola land in Inbox/Meetings, as they open and every 15 minutes.
        The API key stays in this Mac’s Keychain, never in the vault.
      </p>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">API key</span>
          <span className="settings__status" data-testid="granola-key">
            {KEY_STATUS[view.keyState]}
          </span>
        </span>
        <button
          className="btn btn--tinted btn--sm"
          type="button"
          disabled={!hasKey || view.waiting || view.pulling || view.pending}
          onClick={onSyncNow}
        >
          Sync now
        </button>
      </div>
      {view.keyState === 'none' && (
        <p className="settings__lede">
          Make one in Granola → Settings → Connectors → API keys (it needs a Business or Enterprise
          plan), then paste it here. Granola shows it only once.
        </p>
      )}
      <KeyForm hasKey={hasKey} pending={view.pending} onSave={onSaveKey} />
      <SelfEmailsForm
        // Started again once the settings or the Person note are read, so what they hold shows.
        key={`${view.selfEmails}|${view.suggestedEmails ?? ''}`}
        kept={view.selfEmails}
        suggested={view.suggestedEmails}
        onSave={onSaveEmails}
      />
      {hasKey && view.waiting && (
        <p className="settings__lede">Atlas pulls from Granola once this vault has synced.</p>
      )}
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Last pull</span>
          <span className="settings__status" data-testid="granola-pull">
            {pullStatus(view)}
          </span>
        </span>
      </div>
      {view.notes.length > 0 && <NotWritten notes={view.notes} onOpen={onOpenNote} />}
      {view.problem !== null && (
        <p className="settings__problem" role="alert">
          {view.problem}
        </p>
      )}
      {hasKey && <ForgetKey pending={view.pending} onForget={onForgetKey} />}
    </SettingsCard>
  );
}

function KeyForm({
  hasKey,
  pending,
  onSave,
}: {
  hasKey: boolean;
  pending: boolean;
  onSave: (key: string) => void;
}) {
  const [key, setKey] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(key.trim());
    setKey('');
  };

  return (
    <form className="secrets__form" aria-label="Set the Granola API key" onSubmit={submit}>
      <input
        className="field secrets__field"
        type="password"
        aria-label="Granola API key"
        placeholder={hasKey ? 'Paste a new key to replace it' : 'grn_…'}
        autoComplete="off"
        spellCheck={false}
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <button
        className="btn btn--primary btn--sm"
        type="submit"
        disabled={pending || key.trim() === ''}
      >
        Save
      </button>
    </form>
  );
}

function SelfEmailsForm({
  kept,
  suggested,
  onSave,
}: {
  kept: string;
  suggested: string | null;
  onSave: (emails: string) => void;
}) {
  const offered = kept === '' ? (suggested ?? '') : kept;
  const [emails, setEmails] = useState(offered);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(emails);
  };

  return (
    <>
      <p className="settings__lede">
        In a meeting you own, Granola calls you “me”; Atlas writes that as <b>You</b> when the
        meeting’s owner is one of these addresses, and as the owner’s name otherwise.
      </p>
      <form className="secrets__form" aria-label="Your emails in Granola" onSubmit={submit}>
        <input
          className="field secrets__field"
          aria-label="Your emails"
          placeholder="you@example.com, another@example.com"
          autoComplete="off"
          spellCheck={false}
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
        />
        <button className="btn btn--tinted btn--sm" type="submit" disabled={emails === kept}>
          Save emails
        </button>
      </form>
      {kept === '' && suggested !== null && (
        <p className="settings__status">From your Person note. Press Save emails to use them.</p>
      )}
    </>
  );
}

function NotWritten({
  notes,
  onOpen,
}: {
  notes: readonly GranolaNoteLine[];
  onOpen: (url: string) => void;
}) {
  return (
    <details className="granola__details">
      <summary>Details</summary>
      <ul className="granola__notes" aria-label="Meetings not written">
        {notes.map(({ id, title, problem, url }) => (
          <li key={id} className="granola__note">
            <span className="settings__row-label">{title}</span>
            <span className="settings__status">{problem}</span>
            {url !== null && (
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => onOpen(url)}>
                Open in Granola
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ForgetKey({ pending, onForget }: { pending: boolean; onForget: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <div className="settings__actions">
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          Forget key…
        </button>
      </div>
    );
  }
  return (
    <div className="settings__confirm" role="group" aria-label="Forget the Granola key?">
      <p className="settings__lede">
        Atlas stops pulling from Granola on this Mac. Meetings already in the vault stay. Granola
        does not show a key again, so you would make a new one to start again.
      </p>
      <div className="settings__actions">
        <button
          className="btn btn--primary btn--sm"
          type="button"
          // The host does not order a forget after a save under way: the save could undo it.
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            onForget();
          }}
        >
          Forget key
        </button>
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
