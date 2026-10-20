import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import {
  createVaultPath,
  offersLinkCreate,
  placeCrumb,
  rankLinkChoices,
  relationHue,
  type LinkSuggestion,
} from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { isImeKey } from '../ime.ts';
import type { RelationChoice } from '../properties-panel.tsx';
import { useLinkHints } from './link-hints.tsx';

/** A note to make from what was typed, of one of the types the field points at. */
export interface CreateLink {
  readonly target: string;
  readonly name: string;
}

/** The open list's answer to a key on the field it hangs from: whether it took the key. */
export type ListKeys = (event: KeyboardEvent<HTMLInputElement>) => boolean;

/** Offer every note there is: `[[` typed in a plain text field, which keeps to no type. */
export const EVERY_NOTE = 'every note';

type Row =
  | { readonly kind: 'note'; readonly suggestion: LinkSuggestion<RelationChoice> }
  | { readonly kind: 'create'; readonly target: string };

/**
 * The suggestions under a link field while it is open (#465): the notes that
 * meet what was typed, ranked by `rankLinkChoices` — aliases and use read
 * from the app only now, as the list opens — then "Create <type> '<typed>'"
 * when no note is called that. Each row says the note's title, the alias it
 * matched by, its type in that type's hue, and its folder.
 *
 * The focus never leaves the field: the field hands its keys here (`keysRef`)
 * and the active row is named on it as its active descendant. ↑ ↓ move, ↵
 * picks, Tab takes the active row once something is typed; none of them
 * while an input method is composing.
 */
export function LinkSuggestions({
  listId,
  inputRef,
  keysRef,
  query,
  choices,
  creates = NO_TYPES,
  onPick,
  onCreate,
}: {
  listId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Where the field finds the list's answer to its keys. */
  keysRef: RefObject<ListKeys | null>;
  query: string;
  choices: readonly RelationChoice[] | typeof EVERY_NOTE;
  /** The types a note can be made of here; none, and nothing is offered to be made. */
  creates?: readonly string[];
  onPick: (choice: RelationChoice) => void;
  onCreate?: (request: CreateLink) => Promise<void>;
}) {
  const source = useLinkHints();
  const { want } = source;
  useEffect(want, [want]);
  const offered = choices === EVERY_NOTE ? (source.notes ?? NO_CHOICES) : choices;
  const ranked = useMemo(
    () => rankLinkChoices({ query, choices: offered, hints: source.hints }),
    [query, offered, source.hints],
  );
  const making = useMaking(onCreate);
  const makes = onCreate !== undefined && offersLinkCreate({ query, ranked }) ? creates : NO_TYPES;
  const rows: readonly Row[] = [
    ...ranked.map((suggestion) => ({ kind: 'note' as const, suggestion })),
    ...makes.map((target) => ({ kind: 'create' as const, target })),
  ];
  const [moved, setMoved] = useState<{ query: string; at: number } | null>(null);
  // Something typed puts the best match under ↵; nothing typed, none yet.
  const wanted = moved?.query === query ? moved.at : query.trim() === '' ? -1 : 0;
  const at = Math.min(wanted, rows.length - 1);

  const choose = (row: Row) => {
    if (row.kind === 'note') onPick(row.suggestion.choice);
    else making.create({ target: row.target, name: query.trim() });
  };
  const onKey: ListKeys = (event) => {
    if (isImeKey(event) || making.busy) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return true;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setMoved({ query, at: (at + step + rows.length) % rows.length });
      return true;
    }
    const row = rows[at];
    const takes = event.key === 'Enter' || (event.key === 'Tab' && query.trim() !== '');
    if (!takes || row === undefined) return false;
    event.preventDefault();
    event.stopPropagation();
    choose(row);
    return true;
  };
  // Handed to the field after each render, so its keys meet the rows as drawn.
  useLayoutEffect(() => {
    keysRef.current = onKey;
    return () => {
      keysRef.current = null;
    };
  });
  useActiveDescendant(inputRef, at < 0 ? null : `${listId}-${at}`);
  const listRef = useRef<HTMLUListElement>(null);
  usePlacedUnder(inputRef, listRef);

  if (rows.length === 0 && making.problem === null) return null;
  return (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label="Suggested notes"
      className="link-suggest"
    >
      {rows.map((row, index) => (
        <li
          key={row.kind === 'note' ? row.suggestion.choice.path : `create:${row.target}`}
          id={`${listId}-${index}`}
          role="option"
          aria-label={row.kind === 'note' ? spokenName(row.suggestion) : undefined}
          aria-selected={index === at}
          aria-disabled={(row.kind === 'create' && making.busy) || undefined}
          className={index === at ? 'link-suggest__row link-suggest__row--on' : 'link-suggest__row'}
          // Before the field's blur, which would close the list under the pointer.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!making.busy) choose(row);
          }}
        >
          {row.kind === 'note' ? (
            <SuggestedNote suggestion={row.suggestion} />
          ) : (
            <span className="link-suggest__create">
              <Icon name="plus" size={14} />
              Create {row.target} ‘{query.trim()}’
            </span>
          )}
        </li>
      ))}
      {making.problem !== null && (
        <li className="link-suggest__problem" role="alert">
          {making.problem}
        </li>
      )}
    </ul>
  );
}

function SuggestedNote({ suggestion }: { suggestion: LinkSuggestion<RelationChoice> }) {
  const { choice, alias } = suggestion;
  return (
    <>
      <span className="link-suggest__title">{choice.title}</span>
      {alias !== null && <span className="link-suggest__alias">{alias}</span>}
      <span className="link-suggest__where">
        {choice.type !== undefined && (
          <span className="link-suggest__type" data-hue={relationHue({ key: choice.type })}>
            {choice.type}
          </span>
        )}
        <span className="link-suggest__folder">
          {placeCrumb(createVaultPath(choice.path)).parent}
        </span>
      </span>
    </>
  );
}

/** What a screen reader says for a note offered: "Mara Quill, also MQ, person, People". */
function spokenName({ choice, alias }: LinkSuggestion<RelationChoice>): string {
  return [
    choice.title,
    alias === null ? null : `also ${alias}`,
    choice.type ?? null,
    placeCrumb(createVaultPath(choice.path)).parent,
  ]
    .filter((part) => part !== null)
    .join(', ');
}

/** A note being made from the list: whether one is, and why the last could not be. */
function useMaking(onCreate: ((request: CreateLink) => Promise<void>) | undefined) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Read as the key lands, before a render: a second ↵ would make a second note.
  const making = useRef(false);
  return {
    busy,
    problem,
    create: (request: CreateLink) => {
      if (onCreate === undefined || making.current) return;
      making.current = true;
      setBusy(true);
      setProblem(null);
      onCreate(request).then(
        () => {
          making.current = false;
          setBusy(false);
        },
        (cause: unknown) => {
          making.current = false;
          setBusy(false);
          setProblem(cause instanceof Error ? cause.message : String(cause));
        },
      );
    },
  };
}

/**
 * Names the active row on the field, as ARIA's combobox has it. Set on the
 * element here rather than rendered by the field, which does not know the
 * rows; the field never renders the attribute itself, so nothing contends.
 */
function useActiveDescendant(input: RefObject<HTMLInputElement | null>, id: string | null) {
  useLayoutEffect(() => {
    const field = input.current;
    if (field === null) return;
    if (id === null) field.removeAttribute('aria-activedescendant');
    else field.setAttribute('aria-activedescendant', id);
    return () => field.removeAttribute('aria-activedescendant');
  }, [input, id]);
}

/** The gap between the field and its list, in pixels. */
const GAP = 4;

/**
 * Places the list under its field on the window — above it when the window
 * has no room below — so no scrolling sheet or table row it sits in cuts it
 * off: an Inbox row's list once showed two notes of five. Fixed, then put
 * right by however far an ancestor that holds fixed things (a transformed
 * popover) moved it. Written on the element, not rendered: nothing draws
 * again as the page scrolls under an open list.
 */
function usePlacedUnder(
  inputRef: RefObject<HTMLInputElement | null>,
  listRef: RefObject<HTMLUListElement | null>,
) {
  useLayoutEffect(() => {
    const place = () => {
      const field = inputRef.current;
      const list = listRef.current;
      if (field === null || list === null) return;
      const under = field.getBoundingClientRect();
      const tall = list.offsetHeight;
      const below = under.bottom + GAP + tall <= window.innerHeight || under.top < tall + GAP;
      const top = below ? under.bottom + GAP : under.top - GAP - tall;
      list.style.position = 'fixed';
      list.style.top = `${top}px`;
      list.style.left = `${under.left}px`;
      const landed = list.getBoundingClientRect();
      list.style.top = `${2 * top - landed.top}px`;
      list.style.left = `${2 * under.left - landed.left}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });
}

const NO_TYPES: readonly string[] = [];
const NO_CHOICES: readonly RelationChoice[] = [];
