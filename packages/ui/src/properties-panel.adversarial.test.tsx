// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropertyDef } from '@atlas/domain';
import { PropertiesPanel, type PropertyRow } from './properties-panel.tsx';

const relation = (extra: Partial<PropertyDef> = {}): PropertyRow => ({
  def: {
    key: 'field',
    kind: 'relation',
    label: 'Field',
    required: false,
    options: [],
    target: 'company',
    many: false,
    ...extra,
  },
  value: null,
  error: null,
});

describe('"New company…" in a relation picker — attacks (issue #15)', () => {
  it('adds the new note beside the ones a many-relation holds, rather than replacing them', async () => {
    const onChange = vi.fn();
    render(
      <PropertiesPanel
        typeName="person"
        rows={[{ ...relation({ many: true }), value: ['[[Acme]]'] }]}
        relationChoices={{ field: [] }}
        onChange={onChange}
        onCreateRelated={async () => '[[Globex]]'}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Field' }), 'New company…');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Name of the new company' }),
      'Globex{Enter}',
    );

    const [, update] = onChange.mock.lastCall as [string, (current: unknown) => unknown];
    // Applied to what the file holds when the write lands, typed since included.
    expect(update(['[[Acme]]', '[[Initech]]'])).toEqual(['[[Acme]]', '[[Initech]]', '[[Globex]]']);
  });

  it('makes one note for a name entered twice while the first is still being made', async () => {
    // The first create never settles inside the test, as a slow disk would not.
    const onCreateRelated = vi.fn(() => new Promise<string>(() => undefined));
    render(
      <PropertiesPanel
        typeName="person"
        rows={[relation()]}
        relationChoices={{ field: [] }}
        onChange={vi.fn()}
        onCreateRelated={onCreateRelated}
      />,
    );

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Field' }), 'New company…');
    const name = screen.getByRole('textbox', { name: 'Name of the new company' });
    await userEvent.type(name, 'Acme');
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.keyDown(name, { key: 'Enter' });

    expect(onCreateRelated).toHaveBeenCalledTimes(1);
  });
});
