// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './app-shell.tsx';

describe('AppShell', () => {
  it('renders the sidebar and the panes it is given', () => {
    render(<AppShell sidebar={<p>tree</p>} panes={[<p key="a">left</p>, <p key="b">right</p>]} />);
    expect(screen.getByText('tree')).toBeDefined();
    expect(screen.getByText('left')).toBeDefined();
    expect(screen.getByText('right')).toBeDefined();
  });

  it('shows a whole-width surface in place of the panes', () => {
    render(<AppShell sidebar={null} main={<p>table</p>} panes={[<p key="a">note</p>]} />);
    expect(screen.getByText('table')).toBeDefined();
    expect(screen.queryByText('note')).toBeNull();
  });

  it('shows notices above the work', () => {
    render(<AppShell sidebar={null} notices={<p role="alert">broken</p>} />);
    expect(screen.getByRole('alert').textContent).toBe('broken');
  });

  it('labels the sidebar for screen readers', () => {
    render(<AppShell sidebar={null} />);
    expect(screen.getByRole('navigation', { name: 'Vault' })).toBeDefined();
  });

  it('announces the background status rather than drawing a status bar', () => {
    render(<AppShell sidebar={null} status="208 notes indexed" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('208 notes indexed');
    expect(status.className).toContain('visually-hidden');
  });
});

describe('AppShell sidebar', () => {
  it('shows the sidebar by default', () => {
    render(<AppShell sidebar={<p>tree</p>} />);
    expect(screen.getByRole('navigation', { name: 'Vault' })).toBeDefined();
  });

  it('hides the sidebar when it is closed', () => {
    render(<AppShell sidebar={<p>tree</p>} sidebarOpen={false} />);
    expect(screen.queryByRole('navigation', { name: 'Vault' })).toBeNull();
    expect(screen.queryByText('tree')).toBeNull();
  });

  it('offers to show it again when hidden', async () => {
    const onShowSidebar = vi.fn();
    render(<AppShell sidebar={null} sidebarOpen={false} onShowSidebar={onShowSidebar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(onShowSidebar).toHaveBeenCalledTimes(1);
  });

  it('draws no show button while the sidebar is open — hiding it is the sidebar’s own', () => {
    render(<AppShell sidebar={null} sidebarOpen={true} onShowSidebar={() => {}} />);
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull();
  });

  it('has no toggle when the app does not offer one', () => {
    render(<AppShell sidebar={null} sidebarOpen={false} />);
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull();
  });
});
