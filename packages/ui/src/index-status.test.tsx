// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IndexSettings, indexStatusText } from './index-status.tsx';

const ready = { kind: 'ready', info: { name: 'Atlas', version: '0.1.0' } } as const;
const noop = () => {};

describe('indexStatusText', () => {
  it('says how many notes are indexed, grouped for reading', () => {
    expect(indexStatusText({ kind: 'ready', notes: 1240 })).toBe('1,240 notes indexed');
  });

  it('shows progress while indexing, and a plain word before the total is known', () => {
    expect(indexStatusText({ kind: 'working', done: 30, total: 90 })).toBe('Indexing 30/90…');
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
  it('shows the count and the app version', () => {
    render(<IndexSettings index={{ kind: 'ready', notes: 208 }} app={ready} onRebuild={noop} />);
    expect(screen.getByText('208 notes indexed')).toBeDefined();
    expect(screen.getByText('Atlas 0.1.0')).toBeDefined();
  });

  it('rebuilds on request', async () => {
    const onRebuild = vi.fn();
    render(<IndexSettings index={{ kind: 'ready', notes: 3 }} app={ready} onRebuild={onRebuild} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rebuild' }));
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it('disables rebuilding while the index is being built', () => {
    render(
      <IndexSettings index={{ kind: 'working', done: 0, total: 0 }} app={ready} onRebuild={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Rebuild' }).hasAttribute('disabled')).toBe(true);
  });

  it('announces an index failure', () => {
    render(
      <IndexSettings
        index={{ kind: 'failed', message: 'cannot open index' }}
        app={ready}
        onRebuild={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('cannot open index');
  });

  it('offers no rebuild when no vault is open', () => {
    render(<IndexSettings index={null} app={ready} onRebuild={noop} />);
    expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull();
    expect(screen.getByText('Open a vault to index it.')).toBeDefined();
  });

  it('shows nothing about the app while it is still loading', () => {
    render(<IndexSettings index={null} app={{ kind: 'loading' }} onRebuild={noop} />);
    expect(screen.queryByText(/Atlas/)).toBeNull();
  });

  it('announces a failure to read the app identity', () => {
    render(
      <IndexSettings
        index={null}
        app={{ kind: 'failed', message: 'host unavailable' }}
        onRebuild={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('host unavailable');
  });
});
