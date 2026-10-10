// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropertyDef } from '@atlas/domain';
import { PropertiesPanel, type PropertyRow, type RelationChoice } from './properties-panel.tsx';

const PROJECT: PropertyDef = {
  key: 'project',
  kind: 'relation',
  label: 'Project',
  required: false,
  options: [],
  target: 'project',
  targets: ['project', 'area'],
  many: false,
};

const SINGLE: PropertyDef = {
  key: 'project',
  kind: 'relation',
  label: 'Project',
  required: false,
  options: [],
  target: 'project',
  many: false,
};

const CHOICES: readonly RelationChoice[] = [
  { path: 'Projects/Atlas.md', title: 'Atlas', type: 'project' },
  { path: 'Areas/Garden.md', title: 'Garden', type: 'area' },
  { path: 'Areas/Health.md', title: 'Health', type: 'area' },
];

const row: PropertyRow = { def: PROJECT, value: null, error: null };

function picker(onCreateRelated?: (args: { target: string; name: string }) => Promise<string>) {
  const onChange = vi.fn();
  render(
    <PropertiesPanel
      typeName="task"
      rows={[row]}
      relationChoices={{ project: CHOICES }}
      onChange={onChange}
      {...(onCreateRelated !== undefined && { onCreateRelated })}
    />,
  );
  return { onChange, select: screen.getByLabelText('Project') };
}

describe('a relation that points at a project or an area', () => {
  it('offers the notes of both types, each under its own', () => {
    const { select } = picker();
    const groups = [...select.querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual(['Project', 'Area']);
    expect(groups.map((group) => [...group.children].map((option) => option.textContent))).toEqual([
      ['Atlas'],
      ['Garden', 'Health'],
    ]);
  });

  it('names both types in its prompt', () => {
    const { select } = picker();
    expect(select.querySelector('option')?.textContent).toBe('— no project or area —');
  });

  it('links an area as readily as a project', async () => {
    const { onChange, select } = picker();
    await userEvent.selectOptions(select, 'Garden');
    expect(onChange).toHaveBeenLastCalledWith('project', '[[Areas/Garden]]');
  });

  it('offers a new note of each type, and makes the one picked', async () => {
    const onCreateRelated = vi.fn(async () => '[[Kitchen]]');
    const { onChange, select } = picker(onCreateRelated);
    const offered = [...select.querySelectorAll(':scope > option')].map((o) => o.textContent);
    expect(offered.slice(-2)).toEqual(['New project…', 'New area…']);

    await userEvent.selectOptions(select, 'New area…');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Name of the new area' }),
      'Kitchen{Enter}',
    );
    expect(onCreateRelated).toHaveBeenCalledWith({ target: 'area', name: 'Kitchen' });
    expect(onChange).toHaveBeenLastCalledWith('project', '[[Kitchen]]');
  });

  it('draws one type plainly, with no group around it', () => {
    render(
      <PropertiesPanel
        typeName="task"
        rows={[{ def: SINGLE, value: null, error: null }]}
        relationChoices={{ project: [CHOICES[0]!] }}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText('Project');
    expect(select.querySelectorAll('option')).toHaveLength(2);
    expect(select.querySelectorAll('optgroup')).toHaveLength(0);
  });
});
