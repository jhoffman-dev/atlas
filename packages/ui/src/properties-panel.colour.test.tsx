// @vitest-environment jsdom
/**
 * The properties panel — and so the right sidebar, which draws it — colours
 * what a person scans for (#413): a select's pill and each linked note's
 * chip, in the same colour the table gives the same value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createVaultPath,
  hueOf,
  noteNames,
  relationHue,
  type PropertyDef,
  type PropertyKind,
} from '@dfai/domain';
import { NoteNamesProvider } from './note-names.tsx';
import { PropertiesPanel, type PropertyRow } from './properties-panel.tsx';

afterEach(cleanup);

const row = (
  key: string,
  kind: PropertyKind,
  value: unknown,
  extra: Partial<PropertyDef> = {},
): PropertyRow => ({
  def: {
    key,
    kind,
    label: key,
    required: false,
    options: [],
    target: null,
    many: false,
    ...extra,
  },
  value,
  error: null,
});

const names = noteNames([
  { path: createVaultPath('companies/Larkspur Payroll.md'), title: 'Larkspur Payroll' },
]);

function panel(rows: PropertyRow[]) {
  return render(
    <NoteNamesProvider value={names}>
      <PropertiesPanel typeName="meeting" rows={rows} relationChoices={{}} onChange={vi.fn()} />
    </NoteNamesProvider>,
  );
}

const pillOf = (label: string) => screen.getByLabelText(label).closest('.props__pill');

describe('the properties panel’s colours', () => {
  it('draws a select that is no status in its value’s hue, as the table does', () => {
    panel([row('kind', 'select', 'Interview', { options: ['Interview', '1on1'] })]);
    expect(pillOf('kind')?.getAttribute('data-hue')).toBe(hueOf('Interview'));
    expect(pillOf('kind')?.getAttribute('data-tone')).toBeNull();
  });

  it('draws a select in the colour its type chose', () => {
    panel([row('kind', 'select', '1on1', { options: ['1on1'], colors: { '1on1': 'green' } })]);
    expect(pillOf('kind')?.getAttribute('data-hue')).toBe('green');
  });

  it('keeps a status in its tone', () => {
    panel([row('status', 'select', 'doing', { options: ['doing', 'done'] })]);
    expect(pillOf('status')?.getAttribute('data-tone')).toBe('doing');
  });

  it('keeps a value the type no longer offers on the pill, rather than blanking it', () => {
    panel([row('kind', 'select', 'Standup', { options: ['Interview'] })]);
    expect((screen.getByLabelText('kind') as HTMLSelectElement).value).toBe('Standup');
    expect(pillOf('kind')?.getAttribute('data-hue')).toBe(hueOf('Standup'));
  });

  it('draws a linked note’s chip in the hue of its name', () => {
    const { container } = panel([
      row('companies', 'relation', ['[[Larkspur Payroll]]'], { target: 'company', many: true }),
    ]);
    const chip = container.querySelector('.props__link');
    expect(chip?.textContent).toContain('Larkspur Payroll');
    expect(chip?.getAttribute('data-hue')).toBe(relationHue({ key: 'Larkspur Payroll' }));
  });

  it('colours an aliased link as the note it names, as the table does', () => {
    const { container } = panel([
      row('companies', 'relation', ['[[Larkspur Payroll|Larkspur]]'], {
        target: 'company',
        many: true,
      }),
    ]);
    const chip = container.querySelector('.props__link');
    expect(chip?.textContent).toContain('Larkspur');
    expect(chip?.getAttribute('data-hue')).toBe(relationHue({ key: 'Larkspur Payroll' }));
  });

  it('leaves a link to a missing note uncoloured', () => {
    const { container } = panel([
      row('companies', 'relation', ['[[Tobias Fenn]]'], { target: 'company', many: true }),
    ]);
    const chip = container.querySelector('.props__link');
    expect(chip?.textContent).toContain('Tobias Fenn');
    expect(chip?.getAttribute('data-hue')).toBeNull();
  });
});
