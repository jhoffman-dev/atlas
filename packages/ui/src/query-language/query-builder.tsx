import {
  builderOperatorsFor,
  builderOperatorWords,
  isGroupable,
  isSortable,
  operatorTakesQueryValue,
  startingCondition,
  type BuilderCondition,
  type BuilderOperator,
  type BuilderQuery,
  type QueryField,
} from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { ChoiceSelect, type Choice } from '../choice-select.tsx';
import { ValueControl } from './value-control.tsx';

export interface QueryBuilderProps {
  readonly builder: BuilderQuery;
  readonly onChange: (builder: BuilderQuery) => void;
  /** Every type in the vault, as the From dropdown offers them. */
  readonly types: readonly Choice[];
  /** The fields of the chosen types, and one hop through their relations. */
  readonly fields: readonly QueryField[];
  /** What a note or tag value can be picked from: the target type's notes, the vault's tags. */
  readonly valueChoices: (field: QueryField) => readonly string[];
}

/**
 * The query as dropdowns (P24-02): which types, which conditions, how sorted
 * and grouped. Every change is a new {@link BuilderQuery}; the page turns it
 * into the same text the Text tab edits.
 */
export function QueryBuilder(props: QueryBuilderProps) {
  return (
    <section className="qb" aria-label="Query builder">
      <TypesRow {...props} />
      <ConditionsRow {...props} />
      <SortRow {...props} />
      <GroupRow {...props} />
      <OptionsRow {...props} />
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="qb__row">
      <span className="qb__label">{label}</span>
      <div className="qb__body">{children}</div>
    </div>
  );
}

function TypesRow({ builder, onChange, types }: QueryBuilderProps) {
  const labelOf = (name: string) => types.find((type) => type.value === name)?.label ?? name;
  const addable = types.filter((type) => !builder.types.includes(type.value));
  return (
    <Row label="From">
      {builder.types.map((type) => (
        <span className="qb__chip" key={type}>
          {labelOf(type)}
          {builder.types.length > 1 && (
            <button
              type="button"
              className="qb__chip-remove"
              aria-label={`Remove ${labelOf(type)}`}
              onClick={() =>
                onChange({ ...builder, types: builder.types.filter((kept) => kept !== type) })
              }
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </span>
      ))}
      {addable.length > 0 && (
        <ChoiceSelect
          label="Add type"
          value=""
          choices={[{ value: '', label: '+ Type' }, ...addable]}
          onChange={(type) => {
            if (type !== '') onChange({ ...builder, types: [...builder.types, type] });
          }}
        />
      )}
    </Row>
  );
}

function ConditionsRow(props: QueryBuilderProps) {
  const { builder, onChange, fields } = props;
  const setCondition = (at: number, next: BuilderCondition | null) => {
    const conditions = builder.conditions.flatMap((condition, index) =>
      index !== at ? [condition] : next === null ? [] : [next],
    );
    onChange({ ...builder, conditions });
  };
  const first = fields.find((field) => field.via === null && field.kind !== 'title') ?? fields[0];
  return (
    <Row label="Where">
      {builder.conditions.length > 1 && (
        <span className="qb__match">
          Match
          <ChoiceSelect
            label="Match"
            value={builder.match}
            choices={[
              { value: 'all', label: 'all' },
              { value: 'any', label: 'any' },
            ]}
            onChange={(match) => onChange({ ...builder, match })}
          />
          of these
        </span>
      )}
      {builder.conditions.length > 0 && (
        <ol className="qb__conditions">
          {builder.conditions.map((condition, at) => (
            <ConditionRow
              key={at}
              number={at + 1}
              condition={condition}
              shared={props}
              onChange={(next) => setCondition(at, next)}
            />
          ))}
        </ol>
      )}
      {first !== undefined && (
        <button
          type="button"
          className="qb__add"
          onClick={() =>
            onChange({ ...builder, conditions: [...builder.conditions, startingCondition(first)] })
          }
        >
          <Icon name="plus" size={14} />
          Add condition
        </button>
      )}
    </Row>
  );
}

function ConditionRow({
  number,
  condition,
  shared,
  onChange,
}: {
  number: number;
  condition: BuilderCondition;
  shared: QueryBuilderProps;
  onChange: (condition: BuilderCondition | null) => void;
}) {
  const field = shared.fields.find((candidate) => candidate.text === condition.field);
  const operators: BuilderOperator[] =
    field === undefined ? [condition.op] : builderOperatorsFor(field);
  return (
    <li className="qb__condition">
      <button
        type="button"
        className="qb__not"
        aria-pressed={condition.negated}
        aria-label={`Not ${number}`}
        title="Match the notes this condition does not"
        onClick={() => onChange({ ...condition, negated: !condition.negated })}
      >
        not
      </button>
      <ChoiceSelect
        label={`Field ${number}`}
        value={condition.field}
        choices={fieldChoices(shared.fields, condition.field)}
        onChange={(text) => {
          const picked = shared.fields.find((candidate) => candidate.text === text);
          if (picked !== undefined) onChange(startingCondition(picked));
        }}
      />
      <ChoiceSelect
        label={`Condition ${number}`}
        value={condition.op}
        choices={operators.map((op) => ({
          value: op,
          label: builderOperatorWords(op, field?.kind ?? 'text'),
        }))}
        onChange={(op) =>
          onChange({
            ...condition,
            op,
            value: operatorTakesQueryValue(op) ? condition.value : null,
          })
        }
      />
      {field !== undefined && operatorTakesQueryValue(condition.op) && (
        <ValueControl
          label={`Value ${number}`}
          field={field}
          op={condition.op}
          value={condition.value}
          choices={shared.valueChoices(field)}
          onChange={(value) => onChange({ ...condition, value })}
        />
      )}
      <button
        type="button"
        className="qb__remove"
        aria-label={`Remove condition ${number}`}
        onClick={() => onChange(null)}
      >
        <Icon name="close" size={14} />
      </button>
    </li>
  );
}

/** The fields, labelled, with the one already picked kept even if its type was taken away. */
function fieldChoices(
  fields: readonly QueryField[],
  current: string,
  allow: (field: QueryField) => boolean = () => true,
): Choice[] {
  const choices = fields.filter(allow).map((field) => ({ value: field.text, label: field.label }));
  return current === '' || choices.some((choice) => choice.value === current)
    ? choices
    : [{ value: current, label: current }, ...choices];
}

function SortRow({ builder, onChange, fields }: QueryBuilderProps) {
  const setSort = (sort: BuilderQuery['sort']) => onChange({ ...builder, sort });
  const first = fields.find(
    (field) => field.via === null && isSortable(field) && field.kind !== 'title',
  );
  return (
    <Row label="Sort">
      {builder.sort.map((key, at) => (
        <span className="qb__pair" key={at}>
          <ChoiceSelect
            label={`Sort by ${at + 1}`}
            value={key.field}
            choices={fieldChoices(fields, key.field, isSortable)}
            onChange={(field) =>
              setSort(builder.sort.map((was, index) => (index === at ? { ...was, field } : was)))
            }
          />
          <ChoiceSelect
            label={`Direction ${at + 1}`}
            value={key.direction}
            choices={[
              { value: 'asc', label: 'ascending' },
              { value: 'desc', label: 'descending' },
            ]}
            onChange={(direction) =>
              setSort(
                builder.sort.map((was, index) => (index === at ? { ...was, direction } : was)),
              )
            }
          />
          <button
            type="button"
            className="qb__remove"
            aria-label={`Remove sort ${at + 1}`}
            onClick={() => setSort(builder.sort.filter((_, index) => index !== at))}
          >
            <Icon name="close" size={14} />
          </button>
        </span>
      ))}
      {first !== undefined && (
        <button
          type="button"
          className="qb__add"
          onClick={() => setSort([...builder.sort, { field: first.text, direction: 'asc' }])}
        >
          <Icon name="plus" size={14} />
          Add sort
        </button>
      )}
    </Row>
  );
}

function GroupRow({ builder, onChange, fields }: QueryBuilderProps) {
  const none = { value: '', label: 'Nothing' };
  const [group = '', then = ''] = builder.group;
  // A sub-group needs a group above it, and is never the same field again.
  const setGroup = (field: string) =>
    onChange({
      ...builder,
      group: field === '' ? [] : [field, ...(then !== '' && then !== field ? [then] : [])],
    });
  const setThen = (field: string) =>
    onChange({ ...builder, group: field === '' ? [group] : [group, field] });
  return (
    <Row label="Group">
      <ChoiceSelect
        label="Group by"
        value={group}
        choices={[none, ...fieldChoices(fields, group, isGroupable)]}
        onChange={setGroup}
      />
      {group !== '' && (
        <span className="qb__match">
          then
          <ChoiceSelect
            label="Then group by"
            value={then}
            choices={[
              none,
              ...fieldChoices(fields, then, (field) => isGroupable(field) && field.text !== group),
            ]}
            onChange={setThen}
          />
        </span>
      )}
    </Row>
  );
}

function OptionsRow({ builder, onChange }: QueryBuilderProps) {
  return (
    <Row label="Also">
      <label className="qb__check">
        <input
          type="checkbox"
          checked={builder.includeArchived}
          onChange={(event) => onChange({ ...builder, includeArchived: event.target.checked })}
        />
        Include archived notes
      </label>
      <label className="qb__check">
        At most
        <input
          className="qb__limit"
          type="number"
          min={1}
          aria-label="Row limit"
          placeholder="500"
          value={builder.limit ?? ''}
          onChange={(event) => {
            const limit = Math.floor(Number(event.target.value));
            onChange({
              ...builder,
              limit: event.target.value === '' || !(limit > 0) ? null : limit,
            });
          }}
        />
        rows
      </label>
    </Row>
  );
}
