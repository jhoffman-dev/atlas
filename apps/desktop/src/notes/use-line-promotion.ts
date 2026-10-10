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
import type { LinePromotion, PromotedLine, PromotionNotice } from '@atlas/ui';
import { withGiveUpRecorded } from '../activity/with-give-up-recorded.ts';
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
 * the task is made and the line rewritten in one use-case, and the page says
 * what was made, with one Undo that takes back both. A refusal says why;
 * a promotion or an Undo it gives up on is also recorded in the Activity log.
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
}): LinePromotion | undefined {
  // Kept with the note it is about, so what was said of one is not shown over another.
  const [said, setSaid] = useState<{ path: VaultPath; notice: Said } | null>(null);
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
        setSaid(null);
      } catch (error) {
        setSaid({ path: promotion.source, notice: { message: errorMessage(error) } });
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
        setSaid({
          path: source,
          notice: { message: `“${noteTitle(promotion.task)}” is a task now.`, promotion },
        });
      } catch (error) {
        setSaid({ path: source, notice: { message: errorMessage(error) } });
      }
    },
    [fs, markdown, openNotes, flush, notePaths, taskType, onChanged, activity],
  );

  return useMemo(() => {
    if (path === null) return undefined;
    const shown = said?.path === path ? said.notice : null;
    return {
      promote: (line: PromotedLine) => void promote(path, line),
      notice: shown === null ? null : noticeOf({ said: shown, undo, onOpenNote, dismiss }),
    };
  }, [path, said, promote, undo, onOpenNote, dismiss]);
}

/** What the page says: a message, and the promotion it is about when one was made. */
interface Said {
  readonly message: string;
  readonly promotion?: Promotion;
}

function noticeOf({
  said,
  undo,
  onOpenNote,
  dismiss,
}: {
  said: Said;
  undo: (promotion: Promotion) => Promise<void>;
  onOpenNote: (path: VaultPath) => void;
  dismiss: () => void;
}): PromotionNotice {
  const { promotion } = said;
  return {
    message: said.message,
    onOpen: promotion === undefined ? null : () => onOpenNote(promotion.task),
    onUndo: promotion === undefined ? null : () => void undo(promotion),
    onDismiss: dismiss,
  };
}
