// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  blankBuilder,
  builderFromQuery,
  parseAtlasQuery,
  parseObjectType,
  printAtlasQuery,
  queryableFields,
  queryFromBuilder,
  type BuilderQuery,
  type QueryField,
} from '@atlas/domain';
import { QueryBuilder } from './query-builder.tsx';

const TYPES = [
  parseObjectType({
    name: 'task',
    label: 'Task',
    properties: {
      status: { kind: 'select', options: ['backlog', 'doing', 'done'] },
      due: 'date',
      estimate: 'number',
      project: { kind: 'relation', target: 'project' },
      flagged: 'checkbox',
    },
  }),
  parseObjectType({
    name: 'project',
    label: 'Project',
    properties: { owner: { kind: 'relation', target: 'person' } },
  }),
  parseObjectType({ name: 'person', label: 'Person', properties: {} }),
];

const CHOICES = TYPES.map((type) => ({ value: type.name, label: type.label }));

const valueChoices = (field: QueryField): readonly string[] => {
  if (field.kind === 'tag') return ['q3', 'writing'];
  if (field.target === 'person') return ['Julie', 'Sam'];
  if (field.target === 'project') return ['Atlas', 'Garden'];
  return [];
};

/** The builder over a query, with the text it writes shown beside it, as the page shows it. */
function Harness({ start }: { start: BuilderQuery }) {
  const [builder, setBuilder] = useState(start);
  return (
    <>
      <QueryBuilder
        builder={builder}
        onChange={setBuilder}
        types={CHOICES}
        fields={queryableFields(TYPES, builder.types)}
        valueChoices={valueChoices}
      />
      <output aria-label="Written">{printAtlasQuery(queryFromBuilder(builder))}</output>
    </>
  );
}

function builderFor(text: string): BuilderQuery {
  const reading = builderFromQuery(parseAtlasQuery(text));
  if (!reading.ok) throw new Error(reading.reason);
  return reading.builder;
}

const written = () => screen.getByRole('status', { name: 'Written' }).textContent;
const pick = (name: string, option: string) =>
  userEvent.selectOptions(screen.getByRole('combobox', { name }), option);

describe('QueryBuilder', () => {
  it('builds a query across two types, through a relation, with dropdowns', async () => {
    render(<Harness start={blankBuilder('task')} />);
    expect(written()).toBe('FROM task');

    await pick('Add type', 'project');
    expect(written()).toBe('FROM task, project');

    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await pick('Field 1', 'status');
    await pick('Condition 1', 'is not');
    await pick('Value 1', 'done');
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await pick('Field 2', 'project.owner');
    await pick('Value 2', 'Julie');

    expect(written()).toBe('FROM task, project WHERE status != done AND project.owner = [[Julie]]');
  });

  it('offers only the operators a field’s kind can take', async () => {
    render(<Harness start={builderFor('FROM task WHERE flagged = true')} />);
    const operators = screen.getByRole('combobox', { name: 'Condition 1' });
    const words = [...operators.querySelectorAll('option')].map((option) => option.textContent);
    expect(words).toEqual(['is', 'is not', 'is empty', 'is not empty']);
  });

  it('picks a date that moves, or a day, for a date field', async () => {
    render(<Harness start={builderFor('FROM task WHERE due < 2026-09-30')} />);
    expect(screen.getByLabelText<HTMLInputElement>('Value 1 day').value).toBe('2026-09-30');
    await pick('Value 1', 'Today');
    expect(written()).toBe('FROM task WHERE due < @today');
    expect(screen.queryByLabelText('Value 1 day')).toBeNull();
  });

  it('shows a count from today and the start of the week as the date they are, not as a blank day', () => {
    for (const text of ['FROM task WHERE due > @-30d', 'FROM task WHERE due >= @startOfWeek']) {
      const { unmount } = render(<Harness start={builderFor(text)} />);
      expect(written()).toBe(text);
      const picked = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Value 1' });
      const day = screen.queryByLabelText<HTMLInputElement>('Value 1 day');
      // "On a day…" over an empty day picker reads as a condition with no date at all.
      expect({ text, shown: picked.selectedOptions[0]?.textContent, day: day?.value }).not.toEqual({
        text,
        shown: 'On a day…',
        day: '',
      });
      unmount();
    }
  });

  it('names a count from today and the start of the week in the date list, with no day picker', () => {
    for (const [text, shown] of [
      ['FROM task WHERE due > @-30d', '30 days ago'],
      ['FROM task WHERE due >= @startOfWeek', 'Start of this week'],
    ] as const) {
      const { unmount } = render(<Harness start={builderFor(text)} />);
      const picked = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Value 1' });
      expect(picked.selectedOptions[0]?.textContent).toBe(shown);
      expect(screen.queryByLabelText('Value 1 day')).toBeNull();
      unmount();
    }
  });

  it('types a number for a number field, and a value only where one is asked for', async () => {
    render(<Harness start={builderFor('FROM task WHERE estimate IS EMPTY')} />);
    expect(screen.queryByRole('spinbutton', { name: 'Value 1' })).toBeNull();
    await pick('Condition 1', 'is more than');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Value 1' }), '3');
    expect(written()).toBe('FROM task WHERE estimate > 3');
  });

  it('matches any condition, negates one, and removes one', async () => {
    render(
      <Harness
        start={builderFor('FROM task WHERE status = done AND flagged = true AND due IS EMPTY')}
      />,
    );
    await pick('Match', 'any');
    await userEvent.click(screen.getByRole('button', { name: 'Not 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove condition 3' }));
    expect(written()).toBe('FROM task WHERE status = done OR NOT flagged = true');
  });

  it('groups, then sub-groups, never by the same field twice, and ungroups both at once', async () => {
    render(<Harness start={blankBuilder('task')} />);
    expect(screen.queryByRole('combobox', { name: 'Then group by' })).toBeNull();
    await pick('Group by', 'project');
    const then = screen.getByRole('combobox', { name: 'Then group by' });
    expect([...then.querySelectorAll('option')].map((option) => option.textContent)).not.toContain(
      'Project',
    );
    await pick('Then group by', 'status');
    expect(written()).toBe('FROM task GROUP BY project THEN status');
    await pick('Group by', '');
    expect(written()).toBe('FROM task');
  });

  it('sorts, in either direction, and keeps archived notes and a row limit', async () => {
    render(<Harness start={blankBuilder('task')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add sort' }));
    await pick('Sort by 1', 'due');
    await pick('Direction 1', 'descending');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include archived notes' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Row limit' }), '20');
    expect(written()).toBe('FROM task SORT BY due DESC INCLUDE ARCHIVED LIMIT 20');
    await userEvent.click(screen.getByRole('button', { name: 'Remove sort 1' }));
    expect(written()).toBe('FROM task INCLUDE ARCHIVED LIMIT 20');
  });

  it('takes a type away, but never the last one', async () => {
    render(<Harness start={builderFor('FROM task, project')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Project' }));
    expect(written()).toBe('FROM task');
    expect(screen.queryByRole('button', { name: 'Remove Task' })).toBeNull();
  });
});
