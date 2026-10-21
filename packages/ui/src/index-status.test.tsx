// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IndexSettings, indexStatusText } from './index-status.tsx';

const noop = () => {};

describe('indexStatusText', () => {
  it('says how many notes are indexed, grouped for reading', () => {
    expect(indexStatusText({ kind: 'ready', notes: 1240 })).toBe('1,240 notes indexed');
  });

  it('shows progress while indexing, and a plain word before the total is known', () => {
    expect(indexStatusText({ kind: 'working', done: 30, total: 90 })).toBe('Indexing 30 of 90…');
    expect(indexStatusText({ kind: 'working', done: 1240, total: 5000 })).toBe(
      'Indexing 1,240 of 5,000…',
    );
    expect(indexStatusText({ kind: 'working', done: 0, total: 0 })).toBe('Indexing…');
  });

  it('passes a failure on as it was reported', () => {
    expect(indexStatusText({ kind: 'failed', message: 'cannot open index' })).toBe(
      'cannot open index',
    );
  });

  it('has nothing to say before indexing starts', () => {
    expect(indexStatusText({ kind: 'idle' })).toBe('');
  });
});

describe('IndexSettings', () => {
  it('shows the count', () => {
    render(<IndexSettings index={{ kind: 'ready', notes: 208 }} onRebuild={noop} />);
    expect(screen.getByText('208 notes indexed')).toBeDefined();
  });

  it('rebuilds on request', async () => {
    const onRebuild = vi.fn();
    render(<IndexSettings index={{ kind: 'ready', notes: 3 }} onRebuild={onRebuild} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rebuild' }));
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it('draws Rebuild as a secondary control, not a row-sized one (#318)', () => {
    render(<IndexSettings index={{ kind: 'ready', notes: 3 }} onRebuild={noop} />);
    const rebuild = screen.getByRole('button', { name: 'Rebuild' });
    expect(rebuild.classList).toContain('btn--secondary');
    expect(rebuild.classList).not.toContain('btn--sm');
  });

  it('disables rebuilding while the index is being built', () => {
    render(<IndexSettings index={{ kind: 'working', done: 0, total: 0 }} onRebuild={noop} />);
    expect(screen.getByRole('button', { name: 'Rebuild' }).hasAttribute('disabled')).toBe(true);
  });

  it('announces an index failure', () => {
    render(
      <IndexSettings
        index={{ kind: 'failed', message: 'cannot open index' }}

        onRebuild={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('cannot open index');
  });

  it('offers no rebuild when no vault is open', () => {
    render(<IndexSettings index={null} onRebuild={noop} />);
    expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull();
    expect(screen.getByText('Open a vault to index it.')).toBeDefined();
  });
});
