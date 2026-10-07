// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createVaultPath, type MentionSuggestion } from '@atlas/domain';
import { MentionSuggestionPopup } from './mention-suggestion-popup.tsx';

const JULIE: MentionSuggestion = {
  kind: 'person',
  path: createVaultPath('People/julie Brandt.md'),
  name: 'julie Brandt',
  target: 'julie Brandt',
};
const NEW: MentionSuggestion = { kind: 'create', name: 'Ann Lee' };

function popup(selected = 0) {
  const insert = vi.fn();
  render(<MentionSuggestionPopup view={{ items: [JULIE, NEW], selected, rect: null, insert }} />);
  return insert;
}

describe('the @ popup', () => {
  it('lists each person with their initial and where they live, then the offer to add one', () => {
    popup();
    const list = screen.getByRole('listbox', { name: 'Mention a person' });
    const [person, create] = within(list).getAllByRole('option');
    // The initial is capitalised even where the name is not.
    expect(person?.textContent).toBe('Jjulie BrandtPeople');
    expect(person?.querySelector('.person-avatar')?.textContent).toBe('J');
    expect(create?.textContent).toBe('Create person “Ann Lee”New person');
    expect(create?.querySelector('.person-avatar')).toBeNull();
  });

  it('marks the one Enter would pick', () => {
    popup(1);
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
  });

  it('hands over the person or the new name picked', () => {
    const insert = popup();
    fireEvent.mouseDown(screen.getByRole('option', { name: /Create person/ }));
    expect(insert).toHaveBeenLastCalledWith(NEW);
    fireEvent.mouseDown(screen.getByRole('option', { name: /julie Brandt/ }));
    expect(insert).toHaveBeenLastCalledWith(JULIE);
  });

  it('lists someone who cannot be linked with the reason, and picking them does nothing', () => {
    const insert = vi.fn();
    const unlinkable: MentionSuggestion = {
      kind: 'unlinkable',
      path: createVaultPath('People/C# Guild.md'),
      name: 'C# Guild',
      reason: '“C# Guild” cannot be linked: a link stops at #',
    };
    render(
      <MentionSuggestionPopup view={{ items: [unlinkable], selected: -1, rect: null, insert }} />,
    );
    const option = screen.getByRole('option', { name: /C# Guild/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('cannot be linked: a link stops at #');
    fireEvent.mouseDown(option);
    expect(insert).not.toHaveBeenCalled();
  });

  it('marks nothing when Enter would pick nothing', () => {
    popup(-1);
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
    ]);
  });
});
