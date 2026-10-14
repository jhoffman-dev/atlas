import { useCallback, useEffect, useRef, useState } from 'react';
import {
  noteTitle,
  shippedPropertiesLine,
  shippedPropertiesSkippedLine,
  typeSetupLines,
  type VaultPath,
} from '@atlas/domain';
import {
  acceptTypeSetup,
  ensureBuiltInTypes,
  type ActivityRecorder,
  type MarkdownPort,
  type ShippedPropertiesAdded,
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
 * project has the PARA types it lacks written in, each built-in type file
 * gains the properties Atlas ships that it predates (#162), and anything else
 * — PARA for a vault without it, PARA's change to the vault's own types — is
 * held as an offer, which the Inbox shows (P30-01).
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

  // Nothing silent: each type written without asking says so in Activity.
  const announce = useCallback(
    (created: readonly VaultPath[]) => {
      for (const path of created) {
        activity.record({
          level: 'info',
          kind: 'app',
          message: `Added the ${noteTitle(path)} type: this vault files by project, and PARA needs it.`,
          subject: { kind: 'note', path },
        });
      }
    },
    [activity],
  );

  // Nothing silent either: each type that gained properties it predates (#162).
  const announceProperties = useCallback(
    ({ gained, skipped, failed }: ShippedPropertiesAdded) => {
      for (const { path, label, added } of gained) {
        activity.record({
          level: 'info',
          kind: 'app',
          message: shippedPropertiesLine({ label, added }),
          subject: { kind: 'note', path },
        });
      }
      for (const { path, label, reason } of skipped) {
        activity.record({
          level: 'warning',
          kind: 'app',
          message: shippedPropertiesSkippedLine({ label, reason }),
          subject: { kind: 'note', path },
        });
      }
      for (const { name, reason } of failed) {
        activity.record({
          level: 'warning',
          kind: 'app',
          message: `Atlas could not add its built-in properties to ${name}: ${reason}`,
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
    ensureBuiltInTypes({ fs, markdown, vault: vaultKey })
      .then((ensured) => {
        if (cancelled) return;
        report(ensured.failed);
        announceProperties(ensured.properties);
        announce(ensured.created);
        setOffer(ensured.offer);
        if (ensured.created.length + ensured.properties.gained.length > 0) changed.current();
      })
      .catch((cause: unknown) => {
        if (!cancelled) report([{ name: 'PARA', reason: String(cause) }]);
      });
    return () => {
      cancelled = true;
    };
  }, [fs, markdown, vaultKey, report, announce, announceProperties]);

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
