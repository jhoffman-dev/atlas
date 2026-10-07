/**
 * A popup's open state, held by the app rather than by the popup, so the app
 * can keep its one-overlay rule: a menu gives way when a palette opens.
 */
export interface OverlaySlot {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** The slots a pane hands to what it draws, one per popup, by a name unique in the pane. */
export type OverlaySlots = (name: string) => OverlaySlot;
