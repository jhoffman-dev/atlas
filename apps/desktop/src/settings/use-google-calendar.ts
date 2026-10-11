import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dedicatedCalendar,
  needsBlocksCalendar,
  DEDICATED_CALENDAR_NAME,
  type GoogleCalendar,
  type GoogleCalendarSetting,
  type GoogleProblem,
} from '@atlas/domain';
import {
  blockCalendars,
  connectGoogleCalendar,
  createBlocksCalendar,
  disconnectGoogleCalendar,
  googleProblemOf,
  loadGoogleCalendarSetting,
  saveGoogleCalendarSetting,
  type ActivityLog,
  type GoogleCalendarPort,
  type GoogleConnection,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';
import type { GoogleCalendarView, GoogleConnectRequest } from '@atlas/ui';
import { useVaultSetting } from './use-vault-setting.ts';
import { vaultSettingsWriter } from './vault-settings-writer.ts';

/** Settings → Google Calendar as the card draws it, and what it can ask for. */
export interface GoogleCalendarSettingState {
  readonly view: GoogleCalendarView;
  readonly connect: (request: GoogleConnectRequest) => void;
  readonly cancel: () => void;
  readonly disconnect: () => void;
  readonly choose: (calendarId: string) => void;
  readonly create: () => void;
}

const NO_SETTING: GoogleCalendarSetting = { clientId: null, calendarId: null };

const problemOf = (message: string | null): GoogleProblem | null =>
  message === null ? null : { problem: message, fix: null };

/**
 * The open vault's Google Calendar connection, read from the host while
 * Settings is open (`active`), and the client and calendar the vault's
 * settings name. Which calendar blocks go to is kept in the vault, so both
 * Macs use the same one; the sign-in is each Mac's own.
 */
export function useGoogleCalendar({
  port,
  fs,
  markdown,
  vault,
  changeKey,
  active,
  activity,
}: {
  port: GoogleCalendarPort;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  vault: string | null;
  changeKey: string;
  active: boolean;
  /** Where a save of the vault's setting that fails is recorded. */
  activity: Pick<ActivityLog, 'inOpenVault'>;
}): GoogleCalendarSettingState {
  const load = useCallback(() => loadGoogleCalendarSetting({ fs, markdown }), [fs, markdown]);
  const store = useCallback(
    (setting: GoogleCalendarSetting) =>
      saveGoogleCalendarSetting({ settings: vaultSettingsWriter({ fs, markdown }), setting }),
    [fs, markdown],
  );
  const setting = useVaultSetting({ load, store, vaultKey: vault, changeKey, activity });
  const kept = setting.value ?? NO_SETTING;

  const [connection, setConnection] = useState<GoogleConnection | null>(null);
  const [calendars, setCalendars] = useState<readonly GoogleCalendar[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<GoogleProblem | null>(null);
  const [reads, setReads] = useState(0);
  // Reads can land out of order after a change; only the latest may land.
  const latest = useRef(0);

  useEffect(() => {
    latest.current += 1;
    const ticket = latest.current;
    if (vault === null || !active) {
      setConnection(null);
      setCalendars([]);
      return;
    }
    const current = () => ticket === latest.current;
    void (async () => {
      try {
        const found = await port.status({ vault });
        const listed = found.connected ? await blockCalendars({ port, vault }) : [];
        if (!current()) return;
        setConnection(found);
        setCalendars(listed);
      } catch (cause) {
        if (!current()) return;
        setConnection((known) => known ?? { connected: false, clientId: null, scopes: [] });
        setProblem(googleProblemOf(cause));
      }
    })();
  }, [port, vault, active, reads]);

  /** Runs a step, shows what it reports, and reads the connection again. */
  const run = useCallback(async (step: () => Promise<GoogleProblem | null>) => {
    setPending(true);
    setProblem(null);
    try {
      setProblem(await step());
    } catch (cause) {
      setProblem(googleProblemOf(cause));
    } finally {
      setPending(false);
      setReads((count) => count + 1);
    }
  }, []);

  const inVault = (step: (at: string) => Promise<GoogleProblem | null>) => {
    if (vault !== null) void run(() => step(vault));
  };

  const connect = ({ clientId, clientSecret }: GoogleConnectRequest) =>
    inVault(async (at) => {
      setConnecting(true);
      try {
        const made = await connectGoogleCalendar({ port, vault: at, clientId, clientSecret });
        if (made.clientId !== kept.clientId) setting.save({ ...kept, clientId: made.clientId });
        return null;
      } finally {
        setConnecting(false);
      }
    });

  const create = () =>
    inVault(async (at) => {
      const made = await createBlocksCalendar({ port, vault: at });
      setting.save({ ...kept, calendarId: made.id });
      return null;
    });

  const chosen = dedicatedCalendar(calendars, kept.calendarId);
  const phase = connecting
    ? 'connecting'
    : connection === null
      ? 'loading'
      : connection.connected
        ? 'connected'
        : 'disconnected';

  return {
    view: {
      phase,
      clientId: kept.clientId ?? connection?.clientId ?? '',
      calendars: calendars.map(({ id, name }) => ({ id, name })),
      chosen: chosen?.id ?? null,
      canCreate: needsBlocksCalendar(calendars),
      calendarName: DEDICATED_CALENDAR_NAME,
      problem: problem ?? problemOf(setting.problem ?? setting.unreadable),
      pending,
    },
    connect,
    cancel: () => {
      port.cancelConnect().catch((cause: unknown) => setProblem(googleProblemOf(cause)));
    },
    disconnect: () => inVault((at) => disconnectGoogleCalendar({ port, vault: at })),
    choose: (calendarId) => setting.save({ ...kept, calendarId }),
    create,
  };
}
