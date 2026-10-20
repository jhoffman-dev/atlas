import { useCallback, useMemo, useState } from 'react';
import { noteTitle, taskTypeOf, type ObjectType, type VaultPath } from '@atlas/domain';
import {
  promoteChecklistLine,
  PromotionRefused,
  TaskRuleRefusedError,
  undoPromotion,
  UnsavedTypingError,
  type ActivityLog,
  type MarkdownPort,
  type OpenNotes,
  type Promotion,
  type VaultFsPort,
} from '@atlas/application';
import type { LinePromotion, PromotedLine } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
import type { Toasts } from '../toasts/toasts.ts';
import { errorMessage } from '../query/error-message.ts';
import { cryptoRng } from '../random.ts';
import { localToday } from '../today.ts';

/**
 * What Make task and its Undo refuse so as not to lose or double anything —
 * shown on the page for the person to act on, and no fault to record.
 */
const PROMOTION_REFUSALS = [PromotionRefused, TaskRuleRefusedError, UnsavedTypingError];

/**
 * Making a checklist line of the note in a pane a task (P30-03). The pane's
 * typing is written first, so the line is promoted as it is on screen; then
 * the task is made and the line rewritten in one use-case, and the window's
 * toast says what was made (UI v2, slice 15), with Open and one Undo that
 * takes back both — a byte-preserving write, refused once either moved on,
 * and nothing once another vault has opened. A failure is said on the page
 * until dismissed; one it gives up on is also recorded in the Activity log.
 */
export function useLinePromotion({
  fs,
  markdown,
  openNotes,
  flush,
  path,
  notePaths,
  types,
  onChanged,
  onOpenNote,
  activity,
  toasts,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: OpenNotes;
  /** Writes the pane's unsaved typing, settling once it has landed or been refused. */
  flush: () => Promise<void>;
  path: VaultPath | null;
  notePaths: readonly VaultPath[];
  types: readonly ObjectType[];
  /** Re-reads the tree and the index, after the promotion wrote. */
  onChanged: () => void;
  onOpenNote: (path: VaultPath) => void;
  activity: Pick<ActivityLog, 'inOpenVault'>;
  toasts: Pick<Toasts, 'show' | 'vaultNow'>;
}): LinePromotion | undefined {
  // Kept with the note it is about, so what was said of one is not shown over another.
  const [said, setSaid] = useState<{ path: VaultPath; message: string } | null>(null);
  const dismiss = useCallback(() => setSaid(null), []);
  const taskType = useMemo(() => taskTypeOf(types), [types]);

  const undo = useCallback(
    async (promotion: Promotion) => {
      const named = {
        activity,
        write: 'task',
        path: promotion.source,
        refusal: PROMOTION_REFUSALS,
      } as const;
      try {
        await withGiveUpRecorded(named, () => undoPromotion({ fs, openNotes, promotion }));
        onChanged();
      } catch (error) {
        setSaid({ path: promotion.source, message: errorMessage(error) });
      }
    },
    [fs, openNotes, onChanged, activity],
  );

  const promote = useCallback(
    async (source: VaultPath, line: PromotedLine) => {
      const named = { activity, write: 'task', path: source, refusal: PROMOTION_REFUSALS } as const;
      try {
        await flush();
        const promotion = await withGiveUpRecorded(named, () =>
          promoteChecklistLine({
            fs,
            markdown,
            openNotes,
            rng: cryptoRng,
            today: localToday(),
            notePaths,
            taskType,
            choice: { source, line: line.index, text: line.text },
          }),
        );
        onChanged();
        setSaid(null);
        const madeIn = toasts.vaultNow();
        toasts.show({
          message: `“${noteTitle(promotion.task)}” is a task now.`,
          tone: 'change',
          onUndo: () => {
            // Pressed once another vault has opened, its paths are not that vault's: it writes nothing.
            if (toasts.vaultNow() === madeIn) void undo(promotion);
          },
          action: { label: 'Open', onClick: () => onOpenNote(promotion.task) },
        });
      } catch (error) {
        setSaid({ path: source, message: errorMessage(error) });
      }
    },
    [
      fs,
      markdown,
      openNotes,
      flush,
      notePaths,
      taskType,
      onChanged,
      activity,
      toasts,
      undo,
      onOpenNote,
    ],
  );

  const message = path !== null && said?.path === path ? said.message : null;
  const notice = useMemo(
    () => (message === null ? null : { message, onDismiss: dismiss }),
    [message, dismiss],
  );
  return useMemo(() => {
    if (path === null) return undefined;
    return { promote: (line: PromotedLine) => void promote(path, line), notice };
  }, [path, promote, notice]);
}
