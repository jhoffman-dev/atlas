import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Icon, type IconName } from '../icon.tsx';
import { KeyHints } from '../key-hints.tsx';
import { PageMenu, type PageMenuItem } from '../page-bar.tsx';
import { useReturnFocus, type FocusFallback } from '../return-focus.ts';
import { peekKeyAction, peekKeyPlace, steppedIndex, type PeekRowAt } from './peek-keys.ts';

/** The row the peek shows, in the list it was opened from: "3 of 186 in Task table". */
export interface PeekPosition extends PeekRowAt {
  /** What the list is, as the header names it. */
  readonly within: string;
}

export interface PeekDialogProps {
  /** The note's title: the dialog's name. */
  title: string;
  /** Where its row sits; null for a note opened from no list, which then has no stepping. */
  position: PeekPosition | null;
  /** The save state, as a page's bar says it: Saved, Unsaved, Saving…. */
  status: ReactNode;
  /** Shows the row at `index` of the same list instead. */
  onStep: (index: number) => void;
  onClose: () => void;
  /** Opens the note as the page, in place of the tab under the peek. */
  onExpand?: () => void;
  onOpenInNewTab?: () => void;
  onOpenInSplit?: () => void;
  /** The ⋯ menu's commands; left out, there is no menu. */
  menu?: readonly PageMenuItem[];
  /** Where the focus goes on closing when the row that opened the peek has gone. */
  fallbackFocus?: FocusFallback;
  /** Where the dialog is drawn: the document's body, unless given (the gallery's themed panels). */
  container?: RefObject<HTMLElement | null>;
  /** The note: `NotePane` with `chrome="peek"`. */
  children: ReactNode;
}

/**
 * The center peek (brief §5.1, FlowPeek.dc.html): a note over the view it was
 * opened from, 840px on a scrim, with a 44px header — previous and next row,
 * where the row sits, the save state, expand, new tab, split, ⋯ and × — the
 * note itself, and its keys along a 34px foot.
 *
 * Modal, so the focus stays in it; Esc or × closes it and hands the focus
 * back to the row that opened it. Its keys are `peekKeyAction`'s (Q6). It
 * answers nothing else and stops nothing else, so ⌘K still reaches the app.
 */
export function PeekDialog(props: PeekDialogProps) {
  const finalFocus = useReturnFocus(props.fallbackFocus);
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal {...(props.container !== undefined && { container: props.container })}>
        <Dialog.Backdrop className="peek__scrim" />
        <Dialog.Viewport className="peek__viewport">
          <Dialog.Popup
            ref={popup}
            className="peek"
            aria-label={props.title}
            initialFocus={popup}
            finalFocus={finalFocus}
            onKeyDown={(event) => answerPeekKey(event, props)}
          >
            <PeekHeader {...props} />
            <div className="peek__body">{props.children}</div>
            <KeyHints hints={hintsOf(props)} />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function answerPeekKey(event: KeyboardEvent<HTMLElement>, props: PeekDialogProps): void {
  // Answered inside already — a suggestion list's arrows, the editor's own
  // keys — or pressed in something open above the peek, through a portal.
  if (event.defaultPrevented) return;
  if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
  const action = peekKeyAction(event, peekKeyPlace(event.target));
  if (action === null) return;
  if (action.kind === 'step') {
    if (props.position === null) return;
    event.preventDefault();
    step(props, action.by);
    return;
  }
  const open = action.how === 'tab' ? props.onOpenInNewTab : props.onOpenInSplit;
  if (open === undefined) return;
  event.preventDefault();
  open();
}

function step(props: PeekDialogProps, by: -1 | 1): void {
  if (props.position === null) return;
  const next = steppedIndex(props.position, by);
  if (next !== null) props.onStep(next);
}

function PeekHeader(props: PeekDialogProps) {
  const { position } = props;
  return (
    <header className="peek__head">
      {position !== null && (
        <>
          <PeekButton
            icon="up"
            label="Previous row"
            framed
            disabled={steppedIndex(position, -1) === null}
            onClick={() => step(props, -1)}
          />
          <PeekButton
            icon="down"
            label="Next row"
            framed
            disabled={steppedIndex(position, 1) === null}
            onClick={() => step(props, 1)}
          />
          <span className="peek__where">
            {position.index + 1} of {position.count} in {position.within}
          </span>
        </>
      )}
      <span className="peek__gap" />
      <span className="peek__status" role="status">
        {props.status}
      </span>
      {props.onExpand !== undefined && (
        <PeekButton icon="arrow" label="Open as full page" onClick={props.onExpand} />
      )}
      {props.onOpenInNewTab !== undefined && (
        <PeekButton icon="tab" label="Open in new tab" onClick={props.onOpenInNewTab} />
      )}
      {props.onOpenInSplit !== undefined && (
        <PeekButton icon="split" label="Open in split" onClick={props.onOpenInSplit} />
      )}
      {props.menu !== undefined && (
        <PageMenu items={props.menu} open={undefined} onOpenChange={undefined} />
      )}
      <span className="peek__divider" aria-hidden="true" />
      <Dialog.Close className="icon-button peek__button" aria-label="Close" title="Close">
        <Icon name="close" size={15} />
      </Dialog.Close>
    </header>
  );
}

function PeekButton({
  icon,
  label,
  framed = false,
  disabled = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  /** The stepping pair is outlined, as the mockup draws it; the rest are bare. */
  framed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        framed ? 'icon-button peek__button peek__button--framed' : 'icon-button peek__button'
      }
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={framed ? 14 : 15} />
    </button>
  );
}

type Hint = readonly [keys: string, does: string];

/** The foot's key hints: only the keys that do something here. */
function hintsOf(props: PeekDialogProps): readonly Hint[] {
  const hints: Hint[] = [['esc', 'close']];
  if (props.position !== null) {
    hints.push(['↑ ↓', 'previous / next row'], ['⌥↑ ⌥↓', 'from the text']);
  }
  if (props.onOpenInNewTab !== undefined) hints.push(['⌘↵', 'open in tab']);
  if (props.onOpenInSplit !== undefined) hints.push(['⌘⇧↵', 'open in split']);
  return hints;
}
