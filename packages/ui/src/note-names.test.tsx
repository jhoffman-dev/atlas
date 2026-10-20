// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import { LinkedNote } from './note-names.tsx';

const path = createVaultPath('Tasks/A15-02.md');

describe('LinkedNote: what a preview card finds it by (Q22)', () => {
  it('carries the path of a note it opens', () => {
    render(
      <LinkedNote
        name={{ text: 'A15-02', path, missing: false }}
        className="x"
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Open A15-02' }).dataset['linkPath']).toBe(path);
  });

  it('carries the path of a note it only names', () => {
    render(<LinkedNote name={{ text: 'A15-02', path, missing: false }} className="x" />);
    expect(screen.getByText('A15-02').dataset['linkPath']).toBe(path);
  });

  it('carries nothing for a note that is not there, which has nothing to preview', () => {
    render(<LinkedNote name={{ text: 'Gone', path: null, missing: true }} className="x" />);
    expect(screen.getByText('Gone').hasAttribute('data-link-path')).toBe(false);
  });
});
