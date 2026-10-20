import type { ReactNode } from 'react';
import { Toast, type ToastTone } from './toast.tsx';

/** One toast in the window's queue (#320), as the store that holds them hands it over. */
export interface ToastShown {
  /** Each showing's own, so the same words said twice are two toasts with two times. */
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
  /** Takes the change back; absent when there is nothing to take back. */
  readonly onUndo?: () => void;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

/**
 * The window's toasts, top to bottom oldest first, in one place over the
 * content (#320). Each keeps its own five seconds and its own hold while the
 * pointer or the focus is on it; none takes the focus. `children` are the
 * toasts something else still draws itself, kept in the same column so two
 * never sit on one another.
 */
export function ToastStack({
  toasts,
  onDismiss,
  children,
}: {
  toasts: readonly ToastShown[];
  onDismiss: (id: number) => void;
  children?: ReactNode;
}) {
  const others = children !== undefined && children !== null && children !== false;
  if (toasts.length === 0 && !others) return null;
  return (
    <div className="toast-stack">
      {children}
      {toasts.map(({ id, message, tone, onUndo, action }) => (
        <Toast
          key={id}
          message={message}
          tone={tone}
          {...(onUndo !== undefined && { onUndo })}
          {...(action !== undefined && { action })}
          onDismiss={() => onDismiss(id)}
        />
      ))}
    </div>
  );
}
