import { useId, useMemo, useState } from 'react';
import type { ResearchChoice, PillHue } from '@dfai/domain';
import { ChoiceSelect } from '../choice-select.tsx';
import { Icon } from '../icon.tsx';

/** A research list as its page shows it: still read, failed with a message, or the rows shown of how many. */
export type ResearchListState<Item> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly shown: readonly Item[]; readonly total: number };

/** The value the "every one" option of a filter's dropdown stands for. */
const EVERY = '';

/**
 * Most choices a filter lists in a native dropdown. A native `<select>` of
 * 2,000 sources took WebKit a quarter of a second to build, in one frame,
 * every time All highlights opened; past this a filter is a field that
 * suggests as you type, which costs nothing until it is used.
 */
export const MOST_IN_A_DROPDOWN = 100;

/**
 * A filter: every one, or one of `choices` with how many it would show. A
 * value no choice holds any more (a tag since removed) reads as every one,
 * and is offered as such.
 */
export function FilterSelect<Value extends string>(props: {
  label: string;
  /** What the "every one" option says: "All sources", "Any tag". */
  every: string;
  value: Value | null;
  choices: readonly ResearchChoice<Value>[];
  onChange: (value: Value | null) => void;
}) {
  return props.choices.length > MOST_IN_A_DROPDOWN ? (
    <FilterSearch {...props} />
  ) : (
    <FilterDropdown {...props} />
  );
}

function FilterDropdown<Value extends string>({
  label,
  every,
  value,
  choices,
  onChange,
}: Parameters<typeof FilterSelect<Value>>[0]) {
  const known = value !== null && choices.some((choice) => choice.value === value);
  return (
    <ChoiceSelect<string>
      label={label}
      className="research__select"
      value={known ? value : EVERY}
      choices={[
        { value: EVERY, label: every },
        ...choices.map((choice) => ({
          value: choice.value,
          label: `${choice.label} (${choice.count})`,
        })),
      ]}
      onChange={(picked) =>
        onChange(choices.find((choice) => choice.value === picked)?.value ?? null)
      }
    />
  );
}

/** What a choice is called in the field: its label and count, and its value too when another choice shares both. */
function suggestionLabels<Value extends string>(
  choices: readonly ResearchChoice<Value>[],
): Map<string, Value> {
  const named = new Map<string, Value>();
  const shared = new Set<string>();
  for (const choice of choices) {
    const name = `${choice.label} (${choice.count})`;
    if (named.has(name)) shared.add(name);
    named.set(name, choice.value);
  }
  if (shared.size === 0) return named;
  return new Map(
    choices.map((choice) => {
      const name = `${choice.label} (${choice.count})`;
      return [shared.has(name) ? `${name} · ${choice.value}` : name, choice.value];
    }),
  );
}

/** A filter of many choices: a field that suggests them as you type, and picks the one typed in full. */
function FilterSearch<Value extends string>({
  label,
  every,
  value,
  choices,
  onChange,
}: Parameters<typeof FilterSelect<Value>>[0]) {
  const listId = useId();
  const byName = useMemo(() => suggestionLabels(choices), [choices]);
  const picked = [...byName].find(([, each]) => each === value)?.[0] ?? '';
  // What is being typed; null while the field shows the choice picked.
  const [typed, setTyped] = useState<string | null>(null);
  const change = (text: string) => {
    const choice = byName.get(text);
    if (text.trim() === '') {
      setTyped(null);
      onChange(null);
    } else if (choice !== undefined) {
      setTyped(null);
      onChange(choice);
    } else {
      setTyped(text);
    }
  };
  return (
    <>
      <input
        type="search"
        className="research__select research__suggest"
        aria-label={label}
        list={listId}
        placeholder={every}
        value={typed ?? picked}
        onChange={(event) => change(event.target.value)}
        onBlur={() => setTyped(null)}
      />
      <datalist id={listId}>
        {[...byName.keys()].map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}

/** A row of chips that each turn one value of a filter on or off, in its muted pastel. */
export function ChipToggles<Value extends string>({
  label,
  choices,
  on,
  hueOf,
  onToggle,
}: {
  label: string;
  choices: readonly ResearchChoice<Value>[];
  on: readonly Value[];
  hueOf: (value: Value) => PillHue;
  onToggle: (value: Value) => void;
}) {
  return (
    <div className="research__chips" role="group" aria-label={label}>
      {choices.map((choice) => {
        const pressed = on.includes(choice.value);
        return (
          <button
            key={choice.value}
            type="button"
            className={pressed ? 'research__chip research__chip--on' : 'research__chip'}
            data-hue={hueOf(choice.value)}
            aria-pressed={pressed}
            onClick={() => onToggle(choice.value)}
          >
            {pressed && <Icon name="check" size={12} />}
            {choice.label}
            <span className="research__chip-count">{choice.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "Clear filters", shown only while some filter (or the search) is on, so a list that hides sources can always be shown whole. */
export function ClearFilters({ on, onClear }: { on: boolean; onClear: () => void }) {
  if (!on) return null;
  return (
    <button type="button" className="btn btn--sm research__clear" onClick={onClear}>
      Clear filters
    </button>
  );
}

/** What a list says while it is read, when it failed, or when nothing is in it. */
export function ResearchNotice({
  state,
  reading,
  none,
  noMatch,
}: {
  state: ResearchListState<unknown>;
  reading: string;
  /** Said when the vault holds none at all. */
  none: string;
  /** Said when the filters leave none. */
  noMatch: string;
}) {
  if (state.kind === 'failed') {
    return (
      <p className="table__error" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.kind === 'loading') return <p className="table__empty">{reading}</p>;
  if (state.shown.length > 0) return null;
  return <p className="research__empty">{state.total === 0 ? none : noMatch}</p>;
}

/** "120 of 2,000 sources" beside the page's name, or "2,000 sources" when nothing is filtered out. */
export function shownCount(
  state: ResearchListState<unknown>,
  [one, many]: readonly [string, string],
): string | null {
  if (state.kind !== 'ready' || state.total === 0) return null;
  const total = `${state.total.toLocaleString('en-US')} ${state.total === 1 ? one : many}`;
  return state.shown.length === state.total
    ? total
    : `${state.shown.length.toLocaleString('en-US')} of ${total}`;
}
