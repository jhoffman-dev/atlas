// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createVaultPath } from '@dfai/domain';
import { LinkedNote } from './note-names.tsx';

const path = createVaultPath('Tasks/A15-02.md');

describe('LinkedNote: what a preview card finds it by (Q22)', () => {
  it('carries the path of a note it opens', () => {
    render(
      <LinkedNote
        name={{ text: 'A15-02', path, missing: false, key: 'a15-02' }}
        className="x"
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Open A15-02' }).dataset['linkPath']).toBe(path);
  });

  it('carries the path of a note it only names', () => {
    render(
      <LinkedNote name={{ text: 'A15-02', path, missing: false, key: 'a15-02' }} className="x" />,
    );
    expect(screen.getByText('A15-02').dataset['linkPath']).toBe(path);
  });

  it('carries nothing for a note that is not there, which has nothing to preview', () => {
    render(
      <LinkedNote name={{ text: 'Gone', path: null, missing: true, key: 'gone' }} className="x" />,
    );
    expect(screen.getByText('Gone').hasAttribute('data-link-path')).toBe(false);
  });

  it('keeps its pastel beside the path: the colour pass and the preview both read it', () => {
    render(
      <LinkedNote
        name={{ text: 'A15-02', path, missing: false, key: 'a15-02' }}
        className="x"
        hue="green"
        onOpen={() => {}}
      />,
    );
    const chip = screen.getByRole('button', { name: 'Open A15-02' });
    expect(chip.dataset['linkPath']).toBe(path);
    expect(chip.dataset['hue']).toBe('green');
  });
});
