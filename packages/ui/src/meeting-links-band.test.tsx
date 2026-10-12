// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingLinksBand, type LinksNotice } from './meeting-links-band.tsx';

function band(props: Partial<LinksNotice> = {}) {
  const handlers = { onUndo: vi.fn(), onCorrectAgain: vi.fn() };
  render(
    <MeetingLinksBand
      linked={['Mara Quill', 'Larkspur Payroll']}
      proposals={1}
      undone={false}
      linkedYet
      canUndo
      said={null}
      busy={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

/** P29-06: the band over a meeting, with the two things only the person does to it. */
describe('MeetingLinksBand', () => {
  it('says who linking added and how many proposals wait, and offers both commands', async () => {
    const handlers = band();
    const shown = screen.getByRole('complementary', { name: 'After the meeting' });
    expect(shown.textContent).toContain(
      'Linked · Mara Quill, Larkspur Payroll · 1 proposal in the Inbox',
    );
    expect(screen.queryByRole('status')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Undo links' }));
    await userEvent.click(screen.getByRole('button', { name: 'Correct again' }));

    expect(handlers.onUndo).toHaveBeenCalledTimes(1);
    expect(handlers.onCorrectAgain).toHaveBeenCalledTimes(1);
  });

  it('says when linking was sure of no one, and counts several proposals', () => {
    band({ linked: [], proposals: 2 });
    expect(screen.getByRole('complementary').textContent).toContain(
      'Linked · no one it was sure of · 2 proposals in the Inbox',
    );
  });

  it('turns Undo links off when there is nothing recorded, leaving Correct again', () => {
    band({ linked: [], proposals: 0, canUndo: false });
    expect(screen.getByRole('button', { name: 'Undo links' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Correct again' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('says a meeting Atlas never linked is not linked yet, and names no one', () => {
    band({ linked: [], proposals: 0, linkedYet: false, canUndo: false });
    const text = screen.getByRole('complementary').textContent;
    expect(text).toContain('Not linked by Atlas yet');
    expect(text).not.toContain('no one it was sure of');
  });

  it('says its links were undone, and nothing of who they were', () => {
    band({ undone: true, canUndo: false, linked: ['Mara Quill'], proposals: 1 });
    const text = screen.getByRole('complementary').textContent;
    expect(text).toContain('Links undone');
    expect(text).not.toContain('Mara Quill');
    expect(text).not.toContain('proposal');
  });

  it('says what the last command did, marking a refusal, and holds both buttons while one is written', () => {
    band({ said: { text: 'Nothing to correct.', refused: true }, busy: true });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Nothing to correct.');
    expect(status.className).toContain('links-band__said--refused');
    for (const name of ['Undo links', 'Correct again']) {
      expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    }
  });

  it('does not mark what went well as a refusal', () => {
    band({ said: { text: 'Took back 2 links.', refused: false } });
    expect(screen.getByRole('status').className).not.toContain('refused');
  });
});
