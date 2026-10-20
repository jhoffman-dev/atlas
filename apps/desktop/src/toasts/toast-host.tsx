import { memo, useEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { noticeReport } from '@atlas/domain';
import type { ActivityLog } from '@atlas/application';
import { ToastStack } from '@atlas/ui';
import type { Toasts } from './toasts.ts';

/**
 * The window's toasts, drawn over the content and subscribed to their own
 * store alone (#320). A warning or an error is said in Activity too, once,
 * as it appears, so one missed while it showed can be found later; a change
 * made is not — the file is its record. `children` are toasts still drawn
 * by their own hooks, kept in the same column.
 *
 * Kept from the window's draws: the window is drawn often as a vault opens,
 * and the toasts change only with their own store.
 */
export const ToastHost = memo(function ToastHost({
  toasts,
  activity,
  children,
}: {
  toasts: Toasts;
  activity: Pick<ActivityLog, 'record'>;
  children?: ReactNode;
}) {
  const queue = useStore(toasts.store, (state) => state.toasts);
  const recorded = useRef(0);
  useEffect(() => {
    for (const toast of queue) {
      if (toast.id <= recorded.current) continue;
      recorded.current = toast.id;
      if (toast.tone !== 'change') activity.record(noticeReport(toast.message, toast.tone));
    }
  }, [queue, activity]);
  return (
    <ToastStack toasts={queue} onDismiss={toasts.dismiss}>
      {children}
    </ToastStack>
  );
});
