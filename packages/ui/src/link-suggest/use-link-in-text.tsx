import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createVaultPath, openLinkInText, withLinkInText } from '@atlas/domain';
import { isImeKey } from '../ime.ts';
import { useNoteNames } from '../note-names.tsx';
import { EVERY_NOTE, LinkSuggestions, type ListKeys } from './link-suggestions.tsx';

/** What a plain text field spreads on its `<input>` to suggest notes after `[[`. */
export interface LinkInTextField {
  readonly ref: RefObject<HTMLInputElement | null>;
  readonly role?: 'combobox';
  readonly 'aria-expanded'?: boolean;
  readonly 'aria-controls'?: string;
  readonly 'aria-autocomplete'?: 'list';
  readonly autoComplete: 'off';
  readonly onBlur: () => void;
  readonly onSelect: () => void;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * A plain text field in which `[[` opens the same suggestions a link field
 * offers (#465), over every note — a text property keeps to no type. Picking
 * one puts `[[Its name]]` in place of what was typed after the `[[`, as the
 * note is found (`linkTo`), and writes the field's text the way typing does.
 * Esc closes the list until the text changes.
 *
 * A hook, not a component, so a text field costs no more to draw than it
 * did: the field spreads `field` on its own input and draws `list` after it.
 */
export function useLinkInText({
  value,
  onText,
  onBlur,
}: {
  value: string;
  /** The field's text, typed or with a link put in. */
  onText: (text: string) => void;
  onBlur: () => void;
}): { field: LinkInTextField; list: ReactNode } {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const keys = useRef<ListKeys | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  /** The link Esc closed the list on, in the text as it was: closed until either changes. */
  const [dismissed, setDismissed] = useState<{ value: string; start: number } | null>(null);
  const placeCaret = useCaretAfterPick(input);
  const typing = caret === null ? null : openLinkInText(value, caret);
  const open =
    typing !== null && dismissed?.value === value && dismissed.start === typing.start
      ? null
      : typing;

  const field: LinkInTextField = {
    ref: input,
    autoComplete: 'off',
    ...(open !== null && {
      role: 'combobox' as const,
      'aria-expanded': true,
      'aria-controls': listId,
      'aria-autocomplete': 'list' as const,
    }),
    onBlur: () => {
      setCaret(null);
      onBlur();
    },
    onSelect: () => setCaret(input.current?.selectionStart ?? null),
    onChange: (event) => {
      onText(event.target.value);
      setCaret(event.target.selectionStart);
    },
    onKeyDown: (event) => {
      if (open === null || isImeKey(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissed({ value, start: open.start });
        return;
      }
      keys.current?.(event);
    },
  };
  const list =
    open === null || caret === null ? null : (
      <TextLinkSuggestions
        listId={listId}
        inputRef={input}
        keysRef={keys}
        query={open.query}
        onLink={(link) => {
          const next = withLinkInText({ text: value, caret, link });
          onText(next.text);
          setCaret(next.caret);
          placeCaret(next.caret);
        }}
      />
    );
  return { field, list };
}

/**
 * The list over every note, handing over the link to write. The vault's names
 * are read here, drawn only while the list is open, so a text field is not
 * drawn again each time the vault's names change.
 */
function TextLinkSuggestions({
  listId,
  inputRef,
  keysRef,
  query,
  onLink,
}: {
  listId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  keysRef: RefObject<ListKeys | null>;
  query: string;
  onLink: (link: string) => void;
}) {
  const names = useNoteNames();
  return (
    <LinkSuggestions
      listId={listId}
      inputRef={inputRef}
      keysRef={keysRef}
      query={query}
      choices={EVERY_NOTE}
      onPick={(choice) => onLink(names.linkTo(createVaultPath(choice.path)))}
    />
  );
}

/** Puts the caret just after a picked link once the field shows it. */
function useCaretAfterPick(input: RefObject<HTMLInputElement | null>) {
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = pending.current;
    if (at === null) return;
    pending.current = null;
    input.current?.setSelectionRange(at, at);
  });
  return (at: number) => {
    pending.current = at;
  };
}
