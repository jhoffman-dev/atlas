import { SettingsSection } from './settings-section.tsx';
import { Toggle } from './toggle.tsx';
import { SETTINGS_SECTIONS } from './settings-section-links.ts';

/** What Kindle sync is doing now, while the person waits on it. */
export type KindleBusy = 'connecting' | 'syncing' | 'disconnecting';

/** Settings → Kindle as the card draws it; the words come from the application. */
export interface KindleView {
  /** Whether Kindle is connected on this Mac, as far as DFAI knows. */
  readonly connected: boolean;
  /** Whether Kindle sync may write into the open vault: the person's choice for it, off until made. */
  readonly intoVault: boolean;
  readonly busy: KindleBusy | null;
  /** How the last sync on this Mac ended, in plain words, and when; null for none. */
  readonly last: { readonly message: string; readonly ok: boolean; readonly at: string } | null;
  /** When syncs start again by themselves after Amazon's robot check, in words; null when not held. */
  readonly heldUntil: string | null;
  /** Why Connect or Disconnect did not go through. */
  readonly problem: string | null;
}

const BUSY_WORDS: Record<KindleBusy, string> = {
  connecting: 'Sign in to Amazon in the window DFAI opened, then close it…',
  syncing: 'Syncing Kindle…',
  disconnecting: 'Disconnecting…',
};

function statusOf(view: KindleView): string {
  if (view.busy !== null) return BUSY_WORDS[view.busy];
  if (view.last !== null) return `${view.last.message} (${view.last.at})`;
  return view.connected ? 'Not synced on this Mac yet' : 'Not connected on this Mac';
}

/**
 * Settings → Kindle (#508): Connect opens DFAI's own Amazon sign-in window,
 * Sync now reads the notebook, Disconnect forgets this Mac's session, and a
 * switch chooses whether the open vault takes the highlights at all. Off
 * until the person connects, and off in every vault until they switch it on
 * for that one. What it does and its limits are said before they do.
 */
export function KindleSettings({
  view,
  onConnect,
  onSyncNow,
  onDisconnect,
  onIntoVault,
}: {
  view: KindleView;
  onConnect: () => void;
  onSyncNow: () => void;
  onDisconnect: () => void;
  onIntoVault: (on: boolean) => void;
}) {
  const busy = view.busy !== null;
  return (
    <SettingsSection section={SETTINGS_SECTIONS.kindle}>
      <p className="settings__lede">
        Highlights, underlines and typed notes from your Kindle arrive in your literature notes, one
        note per book in the folder your Literature type names, when DFAI opens and every few hours
        — in the vaults you switch Kindle sync on for, and in no other. DFAI reads Amazon’s Kindle
        notebook page (read.amazon.com) in a window of its own; the Amazon sign-in stays in that
        window’s storage on this Mac, never in the vault. Disconnect deletes that sign-in from this
        Mac; it does not sign you out of Amazon.
      </p>
      <p className="settings__lede">
        Amazon shows only part of each book’s highlights, as its publisher allows (often 10 to 20
        percent). Handwritten notes are not on that page. Reading it automatically is a grey area in
        Amazon’s terms; it is off until you connect, and reads only your own highlights.
      </p>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Sync Kindle into this vault</span>
          <span className="settings__status" data-testid="kindle-vault">
            {view.intoVault
              ? 'On: Kindle highlights are written into this vault.'
              : 'Off: Kindle sync writes nothing into this vault.'}
          </span>
        </span>
        <Toggle
          label="Sync Kindle into this vault"
          checked={view.intoVault}
          onChange={onIntoVault}
        />
      </div>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Last sync</span>
          <span
            className={view.last?.ok === false ? 'settings__problem' : 'settings__status'}
            data-testid="kindle-sync"
            role="status"
          >
            {statusOf(view)}
          </span>
        </span>
      </div>
      {view.heldUntil !== null && (
        <p className="settings__lede">
          Amazon asked DFAI to slow down, so Kindle sync does not run by itself until{' '}
          {view.heldUntil}. Sync now still works.
        </p>
      )}
      {view.problem !== null && (
        <p className="settings__problem" role="alert">
          {view.problem}
        </p>
      )}
      <div className="settings__actions">
        {view.connected ? (
          <>
            <button className="btn btn--primary" type="button" disabled={busy} onClick={onSyncNow}>
              Sync now
            </button>
            <button className="btn btn--ghost" type="button" disabled={busy} onClick={onDisconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <button className="btn btn--primary" type="button" disabled={busy} onClick={onConnect}>
            Connect Kindle
          </button>
        )}
      </div>
    </SettingsSection>
  );
}
