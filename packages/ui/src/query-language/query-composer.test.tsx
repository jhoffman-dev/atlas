// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { blankBuilder, type QueryProblem } from '@atlas/domain';
import { QueryComposer, type QueryComposerProps } from './query-composer.tsx';

function composer(overrides: Partial<QueryComposerProps> = {}) {
  const props: QueryComposerProps = {
    mode: 'text',
    onMode: vi.fn(),
    text: 'FROM task',
    onTextChange: vi.fn(),
    problem: null,
    onRun: vi.fn(),
    builder: null,
    onBuilderChange: vi.fn(),
    textOnly: null,
    choices: { types: [{ value: 'task', label: 'Task' }], fields: [], valueChoices: () => [] },
    ...overrides,
  };
  render(<QueryComposer {...props} />);
  return props;
}

describe('QueryComposer', () => {
  it('edits the text, and runs it with Cmd+Enter', async () => {
    const props = composer();
    const area = screen.getByRole('textbox', { name: 'Query' });
    await userEvent.type(area, ' ');
    expect(props.onTextChange).toHaveBeenCalledWith('FROM task ');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(props.onRun).toHaveBeenCalled();
  });

  it('points at a problem: the line and column, the message, and the characters marked', () => {
    const text = 'FROM task\nWHERE stauts = done';
    const problem: QueryProblem = {
      message: 'A task has no field called stauts.',
      span: { start: 16, end: 22 },
    };
    composer({ text, problem });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Line 2, column 7');
    expect(alert.textContent).toContain('A task has no field called stauts.');
    expect(alert.querySelector('mark')?.textContent).toBe('stauts');
    expect(screen.getByRole('textbox', { name: 'Query' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('marks a problem at the very end, where there is nothing to mark, with a space', () => {
    composer({
      text: 'FROM',
      problem: { message: 'Name a type after FROM.', span: { start: 4, end: 4 } },
    });
    expect(screen.getByRole('alert').querySelector('mark')?.textContent).toBe(' ');
  });

  it('says why a query stays text when the builder cannot show it', () => {
    composer({ textOnly: 'This query brackets AND and OR together.' });
    expect(screen.getByRole('status').textContent).toBe('This query brackets AND and OR together.');
  });

  it('asks for the builder, and shows the query as text above it once open', async () => {
    const props = composer();
    await userEvent.click(screen.getByRole('radio', { name: 'Builder' }));
    expect(props.onMode).toHaveBeenCalledWith('builder');
  });

  it('shows the builder and the text it writes while in builder mode', () => {
    composer({ mode: 'builder', builder: blankBuilder('task') });
    expect(screen.getByRole('region', { name: 'Query builder' })).toBeDefined();
    expect(screen.getByLabelText('Query text').textContent).toBe('FROM task');
    expect(screen.queryByRole('textbox', { name: 'Query' })).toBeNull();
  });
});
