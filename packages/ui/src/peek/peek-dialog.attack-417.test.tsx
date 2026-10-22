// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type PropertyDef, type PropertyKind } from '@dfai/domain';
import { CommitField } from '../commit-field.tsx';
import type { PropertyRow } from '../properties-panel.tsx';
import { PeekDialog, type PeekDialogProps } from './peek-dialog.tsx';
import { PropertiesStrip } from './properties-strip.tsx';

/** Attack on PR #417 (slice 6a): the peek's keys and focus against IME, auto-repeat, fields and steps. */

const TITLE = 'Plant the winter beans';

function props(overrides: Partial<PeekDialogProps> = {}): PeekDialogProps {
  return {
    title: TITLE,
    position: { index: 2, count: 9, within: 'Task table' },
    status: 'Saved',
    onStep: vi.fn(),
    onClose: vi.fn(),
    onOpenInNewTab: vi.fn(),
    onOpenInSplit: vi.fn(),
    children: (
      <>
        <div contentEditable suppressContentEditableWarning aria-label="Body">
          The text
        </div>
        <input aria-label="Owner" type="text" defaultValue="Mara Quill" />
      </>
    ),
    ...overrides,
  };
}

function show(overrides: Partial<PeekDialogProps> = {}) {
  const given = props(overrides);
  render(<PeekDialog {...given} />);
  return given;
}

describe('PeekDialog attack-417: input methods', () => {
  it('does not open in a tab on the ⌘↵ an IME is composing with (isComposing)', () => {
    const { onOpenInNewTab } = show();
    fireEvent.keyDown(screen.getByLabelText('Owner'), {
      key: 'Enter',
      metaKey: true,
      isComposing: true,
    });
    expect(onOpenInNewTab).not.toHaveBeenCalled();
  });

  it("does not open in a tab on WebKit's post-composition ⌘↵ (keyCode 229)", () => {
    const { onOpenInNewTab } = show();
    fireEvent.keyDown(screen.getByLabelText('Owner'), {
      key: 'Enter',
      metaKey: true,
      keyCode: 229,
    });
    expect(onOpenInNewTab).not.toHaveBeenCalled();
  });

  it('does not step on ⌥↓ while an IME is composing in the text', () => {
    const { onStep } = show();
    fireEvent.keyDown(screen.getByLabelText('Body'), {
      key: 'ArrowDown',
      altKey: true,
      isComposing: true,
    });
    expect(onStep).not.toHaveBeenCalled();
  });
});

describe('PeekDialog attack-417: auto-repeat', () => {
  it('opens one tab for one held ⌘↵, not one per auto-repeat', () => {
    const { onOpenInNewTab } = show();
    const dialog = screen.getByRole('dialog', { name: TITLE });
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true });
    for (let i = 0; i < 5; i += 1) {
      fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true, repeat: true });
    }
    expect(onOpenInNewTab).toHaveBeenCalledTimes(1);
  });

  it('opens one split for one held ⌘⇧↵, not one per auto-repeat', () => {
    const { onOpenInSplit } = show();
    const dialog = screen.getByRole('dialog', { name: TITLE });
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true, shiftKey: true });
    for (let i = 0; i < 5; i += 1) {
      fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true, shiftKey: true, repeat: true });
    }
    expect(onOpenInSplit).toHaveBeenCalledTimes(1);
  });
});

describe('PeekDialog attack-417: Escape in a field', () => {
  it('stays open on an Escape the text already answered (closing its suggestion list)', () => {
    const onClose = vi.fn();
    show({ onClose });
    const body = screen.getByLabelText('Body');
    body.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.preventDefault();
    });
    body.focus();
    fireEvent.keyDown(body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets a field that answers Escape (puts its value back) keep the peek open', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    show({
      onClose,
      children: <CommitField label="Estimate" value="2 days" onCommit={onCommit} />,
    });
    const field = screen.getByLabelText<HTMLInputElement>('Estimate');
    field.focus();
    fireEvent.change(field, { target: { value: '3 days' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('2 days');
    expect(onClose).not.toHaveBeenCalled();
  });
});

const row = (key: string, kind: PropertyKind, value: unknown): PropertyRow => ({
  def: {
    key,
    kind,
    label: key[0]!.toUpperCase() + key.slice(1),
    required: false,
    options: [],
    target: null,
    many: false,
  } satisfies PropertyDef,
  value,
  error: null,
});

const NOTES = [
  { path: 'Tasks/Plant the winter beans.md', due: '2026-11-02' },
  { path: 'Tasks/Mend the greenhouse door.md', due: '2026-11-09' },
  { path: 'Tasks/Order seed potatoes.md', due: '2026-11-16' },
] as const;

/** The peek over three notes, each strip keyed by its note as the app keys an editor. */
function SteppingPeek({
  onChange,
}: {
  onChange: (path: string, key: string, value: unknown) => void;
}) {
  const [at, setAt] = useState(0);
  const note = NOTES[at]!;
  return (
    <PeekDialog
      title={note.path}
      position={{ index: at, count: NOTES.length, within: 'Task table' }}
      status="Saved"
      onStep={setAt}
      onClose={() => {}}
    >
      <div
        contentEditable
        suppressContentEditableWarning
        aria-label="Body"
        key={`body-${note.path}`}
      >
        {note.path}
      </div>
      <PropertiesStrip
        key={note.path}
        path={createVaultPath(note.path)}
        typeName="task"
        rows={[row('due', 'date', note.due)]}
        relationChoices={{}}
        onChange={(key, value) => onChange(note.path, key, value)}
      />
    </PeekDialog>
  );
}

describe('PeekDialog attack-417: stepping away from a field', () => {
  it('writes a date typed but not yet left to its own note before ⌥↓ shows the next one', () => {
    const onChange = vi.fn();
    render(<SteppingPeek onChange={onChange} />);
    const region = screen.getByRole('region', { name: 'Properties' });
    const date = region.querySelector<HTMLInputElement>('input[type="date"]')!;
    date.focus();
    fireEvent.change(date, { target: { value: '2027-01-05' } });
    fireEvent.keyDown(date, { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('dialog').textContent).toContain('2 of 3');
    expect(onChange).toHaveBeenCalledWith(
      NOTES[0].path,
      'due',
      expect.stringContaining('2027-01-05'),
    );
  });

  it('keeps the focus inside the peek after ⌥↓ replaces the text it was in', () => {
    render(<SteppingPeek onChange={() => {}} />);
    const body = screen.getByLabelText('Body');
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowDown', altKey: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('2 of 3');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('PeekDialog attack-417: guards', () => {
  it('ignores the arrows of its own ⋯ menu, which is drawn through a portal', async () => {
    const onStep = vi.fn();
    show({ onStep, menu: [{ label: 'Archive', onSelect: () => {} }] });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu');
    const item = within(menu).getAllByRole('menuitem')[0]!;
    fireEvent.keyDown(item, { key: 'ArrowDown' });
    fireEvent.keyDown(item, { key: 'ArrowUp', altKey: true });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('lets ⌘K through from every place: chrome, text and field', () => {
    const { onStep, onOpenInNewTab, onOpenInSplit } = show();
    const seen: boolean[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
    document.addEventListener('keydown', listener);
    for (const target of [
      screen.getByRole('dialog', { name: TITLE }),
      screen.getByLabelText('Body'),
      screen.getByLabelText('Owner'),
    ]) {
      fireEvent.keyDown(target, { key: 'k', metaKey: true });
    }
    document.removeEventListener('keydown', listener);
    expect(seen).toEqual([false, false, false]);
    expect(onStep).not.toHaveBeenCalled();
    expect(onOpenInNewTab).not.toHaveBeenCalled();
    expect(onOpenInSplit).not.toHaveBeenCalled();
  });

  it('does nothing on ↓ at the last row nor ↑ at the first', () => {
    const onStep = vi.fn();
    const { unmount } = render(
      <PeekDialog {...props({ onStep, position: { index: 0, count: 1, within: 'Task table' } })} />,
    );
    const dialog = screen.getByRole('dialog', { name: TITLE });
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown', altKey: true });
    unmount();
    expect(onStep).not.toHaveBeenCalled();
  });
});
