import { useCallback, useEffect, useRef, useState } from 'react';
import { typeSetupLines } from '@atlas/domain';
import {
  acceptTypeSetup,
  ensureBuiltInTypes,
  type ActivityRecorder,
  type MarkdownPort,
  type TypeSetupFailure,
  type TypeSetupOffer,
  type VaultFsPort,
} from '@atlas/application';

const NOTHING_OFFERED: TypeSetupOffer = { types: [], extensions: [] };

/** The offer to set the vault's types up for PARA: types to add, and what its own would gain. */
export interface TypesOffer {
  /** One line per change, saying what it does. */
  readonly lines: readonly string[];
  readonly accept: () => Promise<void>;
  readonly dismiss: () => void;
}

/**
 * Makes the vault's types whole for PARA when it opens: a vault that files by
 * project has the PARA types it lacks written in, and anything else — PARA
 * for a vault without it, a change to the vault's own types — is held as an
 * offer, which the Inbox shows (P30-01).
 */
export function useBuiltInTypes({
  fs,
  markdown,
  vaultKey,
  activity,
  onChanged,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  vaultKey: string | null;
  activity: ActivityRecorder;
  /** After a type file is written, so the types and the tree are read again. */
  onChanged: () => void;
}): TypesOffer | null {
  const [offer, setOffer] = useState<TypeSetupOffer>(NOTHING_OFFERED);
  // Read when a write lands, not a reason to set the vault up again.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  const report = useCallback(
    (failed: readonly TypeSetupFailure[]) => {
      for (const { name, reason } of failed) {
        activity.record({
          level: 'warning',
          kind: 'app',
          message: `The ${name} type could not be set up for PARA: ${reason}`,
          subject: null,
        });
      }
    },
    [activity],
  );

  useEffect(() => {
    setOffer(NOTHING_OFFERED);
    if (vaultKey === null) return;
    let cancelled = false;
    ensureBuiltInTypes({ fs, markdown })
      .then((ensured) => {
        if (cancelled) return;
        report(ensured.failed);
        setOffer(ensured.offer);
        if (ensured.created.length > 0) changed.current();
      })
      .catch((cause: unknown) => {
        if (!cancelled) report([{ name: 'PARA', reason: String(cause) }]);
      });
    return () => {
      cancelled = true;
    };
  }, [fs, markdown, vaultKey, report]);

  const accept = useCallback(async () => {
    const done = await acceptTypeSetup({ fs, markdown, offer });
    report(done.failed);
    setOffer(NOTHING_OFFERED);
    if (done.created.length + done.extended.length > 0) changed.current();
  }, [fs, markdown, offer, report]);

  const dismiss = useCallback(() => setOffer(NOTHING_OFFERED), []);

  const lines = typeSetupLines(offer);
  return lines.length === 0 ? null : { lines, accept, dismiss };
}
