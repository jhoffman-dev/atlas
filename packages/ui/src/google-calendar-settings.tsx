import { useState, type FormEvent } from 'react';
import { SettingsCard } from './settings-card.tsx';

/** Where the connection is: being checked, absent, waiting on the browser, or made. */
export type GoogleCalendarPhase = 'loading' | 'disconnected' | 'connecting' | 'connected';

/** A calendar blocks may go to, as the card lists it. */
export interface GoogleCalendarChoice {
  readonly id: string;
  readonly name: string;
}

/** What went wrong, and what to do about it; the application words both. */
export interface GoogleCalendarProblem {
  readonly problem: string;
  readonly fix: string | null;
}

/** Settings → Google Calendar as the card draws it. */
export interface GoogleCalendarView {
  readonly phase: GoogleCalendarPhase;
  /** The client ID the vault's settings keep; empty when none. */
  readonly clientId: string;
  readonly calendars: readonly GoogleCalendarChoice[];
  /** The calendar blocks go to, while it is listed. */
  readonly chosen: string | null;
  /** Whether to offer to make Atlas's calendar. */
  readonly canCreate: boolean;
  /** The name Atlas gives the calendar it makes. */
  readonly calendarName: string;
  readonly problem: GoogleCalendarProblem | null;
  readonly pending: boolean;
}

/** What a sign-in is asked for with: a client, and its secret when Google issued one. */
export interface GoogleConnectRequest {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Settings → Google Calendar: connect and disconnect, and the one calendar
 * blocks go to. A client secret is typed into a masked field and handed on;
 * no token ever reaches this card, so there is none to show.
 */
export function GoogleCalendarSettings({
  view,
  onConnect,
  onCancel,
  onDisconnect,
  onChoose,
  onCreate,
}: {
  view: GoogleCalendarView;
  onConnect: (request: GoogleConnectRequest) => void;
  onCancel: () => void;
  onDisconnect: () => void;
  onChoose: (calendarId: string) => void;
  onCreate: () => void;
}) {
  return (
    <SettingsCard id="settings-google-calendar" icon="calendar" title="Google Calendar">
      <p className="settings__lede">
        Blocks show as busy on a calendar of their own on your Google account. You sign in in your
        browser; the sign-in stays in this Mac’s Keychain, and Atlas can only see and change
        calendars it made.
      </p>
      {view.phase === 'loading' && <p className="settings__lede">Checking…</p>}
      {view.phase === 'disconnected' && (
        <ConnectForm
          // Started again when the vault's settings are read, so the kept client shows.
          key={view.clientId}
          clientId={view.clientId}
          pending={view.pending}
          onConnect={onConnect}
        />
      )}
      {view.phase === 'connecting' && <Waiting onCancel={onCancel} />}
      {view.phase === 'connected' && (
        <Connected
          view={view}
          onDisconnect={onDisconnect}
          onChoose={onChoose}
          onCreate={onCreate}
        />
      )}
      {view.problem !== null && (
        <div className="settings__confirm" role="alert">
          <p className="settings__problem">{view.problem.problem}</p>
          {view.problem.fix !== null && <p className="settings__lede">{view.problem.fix}</p>}
        </div>
      )}
    </SettingsCard>
  );
}

function ConnectForm({
  clientId,
  pending,
  onConnect,
}: {
  clientId: string;
  pending: boolean;
  onConnect: (request: GoogleConnectRequest) => void;
}) {
  const [client, setClient] = useState(clientId);
  const [secret, setSecret] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConnect({ clientId: client, clientSecret: secret });
    setSecret('');
  };

  return (
    <form className="secrets__form" aria-label="Connect Google Calendar" onSubmit={submit}>
      <input
        className="field secrets__field"
        aria-label="OAuth client ID"
        placeholder="Client ID, ending .apps.googleusercontent.com"
        autoComplete="off"
        spellCheck={false}
        value={client}
        onChange={(event) => setClient(event.target.value)}
      />
      <input
        className="field secrets__field"
        type="password"
        aria-label="Client secret, if Google issued one"
        placeholder="Client secret, if Google issued one"
        autoComplete="new-password"
        spellCheck={false}
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
      />
      <button
        className="btn btn--primary btn--sm"
        type="submit"
        disabled={pending || client.trim() === ''}
      >
        Connect
      </button>
    </form>
  );
}

function Waiting({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="settings__row">
      <p className="settings__lede">Finish signing in in your browser…</p>
      <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function destination(view: GoogleCalendarView): string {
  const chosen = view.calendars.find((calendar) => calendar.id === view.chosen);
  return chosen === undefined
    ? 'Choose the calendar blocks go to.'
    : `Blocks go to ${chosen.name}.`;
}

function Connected({
  view,
  onDisconnect,
  onChoose,
  onCreate,
}: {
  view: GoogleCalendarView;
  onDisconnect: () => void;
  onChoose: (calendarId: string) => void;
  onCreate: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <p className="settings__lede">Connected. {destination(view)}</p>
      <div className="settings__actions">
        {view.calendars.length > 0 && (
          <select
            className="field"
            aria-label="Calendar for blocks"
            value={view.chosen ?? ''}
            disabled={view.pending}
            onChange={(event) => onChoose(event.target.value)}
          >
            <option value="" disabled>
              Choose a calendar
            </option>
            {view.calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </select>
        )}
        {view.canCreate && (
          <button
            className="btn btn--tinted btn--sm"
            type="button"
            disabled={view.pending}
            onClick={onCreate}
          >
            Create “{view.calendarName}”
          </button>
        )}
        {!confirming && (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={view.pending}
            onClick={() => setConfirming(true)}
          >
            Disconnect…
          </button>
        )}
      </div>
      {confirming && (
        <div className="settings__confirm" role="group" aria-label="Disconnect Google Calendar?">
          <p className="settings__lede">
            Atlas forgets the sign-in on this Mac and asks Google to revoke it. The calendar and its
            events stay on your Google account.
          </p>
          <div className="settings__actions">
            <button
              className="btn btn--primary btn--sm"
              type="button"
              onClick={() => {
                setConfirming(false);
                onDisconnect();
              }}
            >
              Disconnect
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
      )}
    </>
  );
}
