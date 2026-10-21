// @vitest-environment jsdom
/**
 * Attack on PR #418 (slice 12): the type editor's rows, driven through a
 * harness that makes each edit with the domain, as the app does.
 */
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyTypeEdit, parseObjectType, TYPE_ICONS, type ObjectType } from '@dfai/domain';
import { TypeEditor } from './type-editor.tsx';

const MEETING = parseObjectType({
  name: 'meeting',
  label: 'Meeting',
  properties: { agenda: 'text', notes: 'text', venue: 'text' },
});

function Harness({ type }: { type: ObjectType }) {
  const [shown, setShown] = useState(type);
  return (
    <TypeEditor
      type={shown}
      icons={TYPE_ICONS}
      targets={[]}
      prompt={null}
      notice={null}
      onEdit={(edit) => setShown((was) => applyTypeEdit(was, edit, { types: [] }).type)}
    />
  );
}

describe('TypeEditor, attacked (#418)', () => {
  it('removing the open property opens no other: the next row does not spring open under the pointer', async () => {
    render(<Harness type={MEETING} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Agenda' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Agenda' }));
    expect(screen.queryByRole('button', { name: 'Edit Agenda' })).toBeNull();
    // Notes now stands where Agenda was; a second click there must not remove it too.
    expect(screen.getByRole('button', { name: 'Edit Notes' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Remove Notes' })).toBeNull();
  });

  it('offers no Required on new notes for a thumbnail, which an empty value never fails', async () => {
    const withThumbnail = parseObjectType({
      name: 'meeting',
      label: 'Meeting',
      properties: { cover: 'thumbnail' },
    });
    render(<Harness type={withThumbnail} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Cover' }));
    expect(screen.getByRole('combobox', { name: 'Kind of Cover' })).toBeDefined();
    // An empty thumbnail means `auto` (validatePropertyValue), so the box would do nothing.
    expect(screen.queryByRole('checkbox', { name: 'Required on new notes' })).toBeNull();
  });
});
