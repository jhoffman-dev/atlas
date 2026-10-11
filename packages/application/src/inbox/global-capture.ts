/**
 * The Tauri event the host emits when the global capture shortcut is pressed,
 * after it has brought the window forward. It carries nothing: the webview is
 * the untrusted side (ADR-0017), so the host registers the shortcut and only
 * says it was pressed (ADR-0033).
 */
export const GLOBAL_CAPTURE_EVENT = 'global-capture';

/** The global capture shortcut as this Mac's host holds it. */
export interface GlobalCaptureShortcut {
  /** As the host registers it — `Control+Alt+KeyN` — or null when it is turned off. */
  readonly shortcut: string | null;
  /** Whether the system took it: false when it is off, or another app holds it. */
  readonly registered: boolean;
  /** Why it is not registered, in words Settings can show; null when it is or it is off. */
  readonly problem: string | null;
}

/**
 * The shortcut that opens quick capture from any app, kept per Mac by the
 * host, since which keys are free is a matter of what else runs on that Mac.
 */
export interface GlobalCapturePort {
  status(): Promise<GlobalCaptureShortcut>;
  /**
   * Registers `shortcut` in place of the one in force — null turns it off —
   * and keeps the choice. Resolves with what holds now, a shortcut another app
   * holds included; rejects only when the host refuses the shortcut itself.
   */
  set(shortcut: string | null): Promise<GlobalCaptureShortcut>;
  /** Calls `pressed` each time the shortcut is pressed; resolves with what stops it. */
  listen(pressed: () => void): Promise<() => void>;
}
