import { useEffect, useRef } from 'react';
import { blockTypeToWrite, type ObjectType } from '@atlas/domain';
import {
  ensureBlockType,
  type ActivityRecorder,
  type MarkdownPort,
  type VaultFsPort,
} from '@atlas/application';

/**
 * Writes the Block type into a vault whose tasks follow GTD and that lacks it
 * (P31-01) — as it opens, or as soon as its tasks move to GTD — and says so in
 * Activity: nothing is added without a word.
 */
export function useBlockType({
  fs,
  markdown,
  vaultKey,
  types,
  activity,
  onChanged,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  vaultKey: string | null;
  /** The vault's types as last read: the type files are read again only when they call for it. */
  types: readonly ObjectType[];
  activity: ActivityRecorder;
  /** After the type file is written, so the types and the tree are read again. */
  onChanged: () => void;
}): void {
  // Read when the write lands, not a reason to look at the vault's types again.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    if (vaultKey === null || blockTypeToWrite(types) === null) return;
    let cancelled = false;
    const warn = (reason: string) =>
      activity.record({
        level: 'warning',
        kind: 'app',
        message: `The Block type could not be added: ${reason}`,
        subject: null,
      });
    ensureBlockType({ fs, markdown })
      .then(({ created, failed }) => {
        if (cancelled) return;
        for (const { reason } of failed) warn(reason);
        for (const path of created) {
          activity.record({
            level: 'info',
            kind: 'app',
            message:
              'Added the Block type: this vault’s tasks follow GTD, and timeblocks schedule them.',
            subject: { kind: 'note', path },
          });
        }
        if (created.length > 0) changed.current();
      })
      .catch((cause: unknown) => {
        if (!cancelled) warn(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [fs, markdown, vaultKey, types, activity]);
}
