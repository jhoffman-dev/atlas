// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_LINK_HINTS, noteNames } from '@atlas/domain';
import { NoteNamesProvider } from '../note-names.tsx';
import { LinkHintsProvider } from './link-hints.tsx';
import { useLinkInText } from './use-link-in-text.tsx';

/** Attacks on PR #469 (#465): `[[` in a plain text property. Fictional names only. */

afterEach(cleanup);

function Field() {
  const [text, setText] = useState('');
  const links = useLinkInText({ value: text, onText: setText, onBlur: () => {} });
  return (
    <span className="link-combo">
      <input id="notes" type="text" value={text} {...links.field} />
      {links.list}
    </span>
  );
}

describe('useLinkInText (attack #469)', () => {
  it('says why there is nothing to suggest when the notes could not be read', async () => {
    const problem = 'The notes to suggest could not be read. Close this and try again. (disk I/O)';
    render(
      <NoteNamesProvider value={noteNames(null)}>
        <LinkHintsProvider value={{ hints: NO_LINK_HINTS, notes: null, problem, want: () => {} }}>
          <label htmlFor="notes">Notes</label>
          <Field />
        </LinkHintsProvider>
      </NoteNamesProvider>,
    );
    await userEvent.type(screen.getByLabelText('Notes'), 'Met [[[[Ma'); // `[[` types one `[`
    // The host passes the failure on "for the picker to say so" (PR #469): it never is.
    expect((await screen.findByRole('alert')).textContent).toContain('could not be read');
  });
});
