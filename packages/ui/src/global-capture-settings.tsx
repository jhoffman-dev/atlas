import { useRef, useState, type KeyboardEvent } from 'react';
import {
  DEFAULT_GLOBAL_CAPTURE_SHORTCUT,
  globalShortcutFromKeys,
  globalShortcutLabel,
} from '@atlas/domain';
import { SettingsCard } from './settings-card.tsx';

/** The shortcut as the host holds it. */
export interface GlobalCaptureView {
  readonly shortcut: string | null;
  readonly registered: boolean;
  readonly problem: string | null;
}

/**
 * Settings → Quick capture from anywhere: the system-wide shortcut that brings
 * Atlas forward with quick capture open (#81). A new one is recorded by
 * pressing it; what counts as a shortcut is the domain's to say, and whether
 * the system gave it to Atlas is the host's.
 */
export function GlobalCaptureSettings({
  view,
  onChange,
}: {
  /** Null until the host has answered. */
  view: GlobalCaptureView | null;
  /** A new shortcut, or null to turn it off. */
  onChange: (shortcut: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const field = useRef<HTMLButtonElement>(null);

  const stopRecording = () => {
    setRecording(false);
    setHint(null);
  };

  // Focused by hand: WebKit, which the app runs in, does not focus a button
  // that is clicked, and the keys must reach this one.
  const startRecording = () => {
    setRecording(true);
    field.current?.focus();
  };

  // Every key is the field's while it records: none may reach the window's
  // own shortcuts (⌘N would make a note) or close Settings.
  const record = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === 'Escape') {
      stopRecording();
      return;
    }
    const reading = globalShortcutFromKeys(event);
    if ('refused' in reading) {
      setHint(reading.refused);
      return;
    }
    stopRecording();
    onChange(reading.shortcut);
  };

  const shortcut = view?.shortcut ?? null;
  return (
    <SettingsCard id="settings-global-capture" icon="inbox" title="Quick capture from anywhere">
      <p className="settings__lede">
        Press it in any app: Atlas comes forward with quick capture open, and what you type lands in
        the Inbox. It is set for this Mac only.
      </p>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Shortcut</span>
          <span className="settings__status">{statusText(view)}</span>
        </span>
        <div className="settings__actions">
          <button
            type="button"
            className="btn btn--tinted btn--sm"
            ref={field}
            aria-pressed={recording}
            onClick={() => (recording ? stopRecording() : startRecording())}
            onKeyDown={record}
            onBlur={stopRecording}
          >
            {recording ? 'Press the shortcut…' : 'Change…'}
          </button>
          {shortcut !== DEFAULT_GLOBAL_CAPTURE_SHORTCUT && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => onChange(DEFAULT_GLOBAL_CAPTURE_SHORTCUT)}
            >
              Use {globalShortcutLabel(DEFAULT_GLOBAL_CAPTURE_SHORTCUT)}
            </button>
          )}
          {shortcut !== null && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(null)}>
              Turn off
            </button>
          )}
        </div>
      </div>
      {recording && (
        <p className="settings__lede" role="status">
          {hint ?? 'Hold two of ⌘, ⌥ and ⌃ and press a key. Esc stops without changing it.'}
        </p>
      )}
      {view !== null && view.problem !== null && (
        <p className="settings__problem" role="alert">
          {view.problem}
        </p>
      )}
    </SettingsCard>
  );
}

function statusText(view: GlobalCaptureView | null): string {
  if (view === null) return 'Checking…';
  if (view.shortcut === null) return 'Off';
  const label = globalShortcutLabel(view.shortcut);
  return view.registered ? label : `${label} — not working`;
}
