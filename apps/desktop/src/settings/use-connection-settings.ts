import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiConnectionStatus, ApiSettingsPort } from '@atlas/application';
import type { ConnectionSettingsState } from '@atlas/ui';
import type { ClipboardWriter } from './clipboard.ts';

export interface ConnectionSettings extends ConnectionSettingsState {
  readonly setEnabled: (enabled: boolean) => void;
  readonly copyToken: () => void;
  readonly rotateToken: () => void;
  readonly copyText: (args: { text: string; notice: string }) => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Settings → Connections: the API's switch, its token, and what was last done
 * with them.
 *
 * One action at a time. Each clears what the last one said, and says either
 * what it did or why it could not.
 */
export function useConnectionSettings({
  settings,
  clipboard,
}: {
  settings: ApiSettingsPort;
  clipboard: ClipboardWriter;
}): ConnectionSettings {
  const [status, setStatus] = useState<ApiConnectionStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    settings
      .status()
      .then((read) => mounted.current && setStatus(read))
      .catch((cause: unknown) => mounted.current && setProblem(messageOf(cause)));
    return () => {
      mounted.current = false;
    };
  }, [settings]);

  /** Runs one action, and says what it did or why it could not. */
  const run = useCallback((action: () => Promise<string | null>, afterFailure?: () => void) => {
    setPending(true);
    setProblem(null);
    setNotice(null);
    action()
      .then((done) => mounted.current && setNotice(done))
      .catch((cause: unknown) => {
        if (!mounted.current) return;
        setProblem(messageOf(cause));
        afterFailure?.();
      })
      .finally(() => mounted.current && setPending(false));
  }, []);

  /** What the host says now, after an action failed part-way: shown as it is, not as hoped. */
  const reread = useCallback(() => {
    settings
      .status()
      .then((read) => mounted.current && setStatus(read))
      .catch(() => {
        // The action's own failure is already shown, and says more than this would.
      });
  }, [settings]);

  const setEnabled = useCallback(
    (enabled: boolean) =>
      run(async () => {
        setStatus(await settings.setEnabled(enabled));
        return null;
      }, reread),
    [run, settings, reread],
  );

  const copyToken = useCallback(
    () =>
      run(async () => {
        await clipboard.write(await settings.token());
        return 'Token copied';
      }),
    [run, settings, clipboard],
  );

  const rotateToken = useCallback(
    () =>
      run(async () => {
        await settings.rotateToken();
        return 'Token rotated. Tools that read the connection file pick up the new one by themselves.';
      }),
    [run, settings],
  );

  const copyText = useCallback(
    ({ text, notice: done }: { text: string; notice: string }) =>
      run(async () => {
        await clipboard.write(text);
        return done;
      }),
    [run, clipboard],
  );

  return { status, problem, notice, pending, setEnabled, copyToken, rotateToken, copyText };
}
