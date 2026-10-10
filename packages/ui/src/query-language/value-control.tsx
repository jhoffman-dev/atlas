import {
  movingDateChoices,
  valueEditorFor,
  valueFromInput,
  valueInputText,
  type BuilderOperator,
  type QueryField,
  type QueryValue,
} from '@atlas/domain';
import { ChoiceSelect, type Choice } from '../choice-select.tsx';

/**
 * The control a condition's value is picked with, chosen by the field's kind:
 * a select's options, the notes a relation can point at, a tag, a date or a
 * date that moves, ticked or not, a number, or words.
 */
export function ValueControl({
  label,
  field,
  op,
  value,
  choices,
  onChange,
}: {
  label: string;
  field: QueryField;
  op: BuilderOperator;
  value: QueryValue | null;
  /** The notes or tags to pick from, for a relation or a tag. */
  choices: readonly string[];
  onChange: (value: QueryValue | null) => void;
}) {
  const text = valueInputText(value);
  const set = (input: string) => onChange(valueFromInput(field, op, input));
  switch (valueEditorFor(field, op)) {
    case 'options':
      return <Picker label={label} text={text} options={field.options} onChange={set} />;
    case 'note':
    case 'tag':
      return choices.length === 0 ? (
        <Typed label={label} text={text} onChange={set} />
      ) : (
        <Picker label={label} text={text} options={choices} onChange={set} />
      );
    case 'boolean':
      return (
        <ChoiceSelect
          label={label}
          value={text === 'false' ? 'false' : 'true'}
          choices={[
            { value: 'true', label: 'ticked' },
            { value: 'false', label: 'not ticked' },
          ]}
          onChange={set}
        />
      );
    case 'date':
      return <DateControl label={label} text={text} onChange={set} />;
    case 'number':
      return <Typed label={label} text={text} onChange={set} type="number" />;
    case 'text':
      return <Typed label={label} text={text} onChange={set} />;
  }
}

/** A dropdown of what there is, keeping a value typed by hand that is not among it. */
function Picker({
  label,
  text,
  options,
  onChange,
}: {
  label: string;
  text: string;
  options: readonly string[];
  onChange: (input: string) => void;
}) {
  const known = options.includes(text) || text === '';
  const choices: Choice[] = [
    ...(text === '' ? [{ value: '', label: 'Choose…' }] : []),
    ...(known ? [] : [{ value: text, label: text }]),
    ...options.map((option) => ({ value: option, label: option })),
  ];
  return <ChoiceSelect label={label} value={text} choices={choices} onChange={onChange} />;
}

function Typed({
  label,
  text,
  onChange,
  type = 'text',
}: {
  label: string;
  text: string;
  onChange: (input: string) => void;
  type?: 'text' | 'number';
}) {
  return (
    <input
      className="qb__input"
      aria-label={label}
      type={type}
      value={text}
      placeholder="Value"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

const ON_A_DAY = 'day';

/** A moving date from the list, or a day from the picker. */
function DateControl({
  label,
  text,
  onChange,
}: {
  label: string;
  text: string;
  onChange: (input: string) => void;
}) {
  const movingDates = movingDateChoices(text);
  const moving = movingDates.some((date) => date.value === text);
  return (
    <span className="qb__date">
      <ChoiceSelect
        label={label}
        value={moving ? text : text === '' ? '' : ON_A_DAY}
        choices={[
          ...(text === '' ? [{ value: '', label: 'Choose…' }] : []),
          ...movingDates,
          { value: ON_A_DAY, label: 'On a day…' },
        ]}
        onChange={(picked) => onChange(picked === ON_A_DAY ? '' : picked)}
      />
      {!moving && (
        <input
          className="qb__input"
          type="date"
          aria-label={`${label} day`}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </span>
  );
}
