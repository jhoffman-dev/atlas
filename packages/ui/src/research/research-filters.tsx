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
 * A filter's dropdown: every one, or one of `choices` with how many it
 * would show. A value no choice holds any more (a tag since removed) reads
 * as every one, and is offered as such.
 */
export function FilterSelect<Value extends string>({
  label,
  every,
  value,
  choices,
  onChange,
}: {
  label: string;
  /** What the "every one" option says: "All sources", "Any tag". */
  every: string;
  value: Value | null;
  choices: readonly ResearchChoice<Value>[];
  onChange: (value: Value | null) => void;
}) {
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
