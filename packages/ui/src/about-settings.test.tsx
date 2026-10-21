// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutSettings } from './about-settings.tsx';

const info = (build: string | null) =>
  ({ kind: 'ready', info: { name: 'Atlas', version: '0.1.0', build } }) as const;

describe('AboutSettings', () => {
  it('names the section About', () => {
    render(<AboutSettings app={info(null)} />);
    expect(screen.getByRole('heading', { name: 'About' })).toBeDefined();
  });

  it('shows the app and its version', () => {
    render(<AboutSettings app={info('61e907b')} />);
    expect(screen.getByText('Atlas 0.1.0')).toBeDefined();
  });

  it('shows the commit the build was made from', () => {
    render(<AboutSettings app={info('61e907b')} />);
    expect(screen.getByText('Build 61e907b')).toBeDefined();
  });

  it('says nothing about a build it does not know', () => {
    render(<AboutSettings app={info(null)} />);
    expect(screen.getByText('Atlas 0.1.0')).toBeDefined();
    expect(screen.queryByText(/Build/)).toBeNull();
  });

  it('shows nothing about the app while it is still loading', () => {
    render(<AboutSettings app={{ kind: 'loading' }} />);
    expect(screen.getByRole('heading', { name: 'About' })).toBeDefined();
    expect(screen.queryByText(/Atlas/)).toBeNull();
  });

  it('announces a failure to read the app identity', () => {
    render(<AboutSettings app={{ kind: 'failed', message: 'host unavailable' }} />);
    expect(screen.getByRole('alert').textContent).toBe('host unavailable');
  });
});
