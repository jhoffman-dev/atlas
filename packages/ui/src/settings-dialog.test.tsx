// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsDialog, type ConnectionSettingsState } from './settings-dialog.tsx';

const RUNNING = { enabled: true, port: 7420, running: true, file: '/Users/j/api.json' };
const OFF = { enabled: false, port: null, running: false, file: '/Users/j/api.json' };

function show(connection: Partial<ConnectionSettingsState> = {}, placeholder = false) {
  const handlers = {
    onEnable: vi.fn(),
    onCopyToken: vi.fn(),
    onRotateToken: vi.fn(),
    onCopyMcpCommand: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <SettingsDialog
      connection={{ status: OFF, problem: null, notice: null, pending: false, ...connection }}
      mcp={{ command: 'claude mcp add atlas -- node /x/main.js', placeholder }}
      {...handlers}
    />,
  );
  return handlers;
}

const statusText = () => screen.getByTestId('api-status').textContent;
const apiSwitch = () => screen.getByRole('switch', { name: 'Local API' });

describe('SettingsDialog, Connections', () => {
  it('reads Off, with the switch off, while the API is off', () => {
    show({ status: OFF });
    expect(statusText()).toBe('Off');
    expect(apiSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('names the port while the API is running', () => {
    show({ status: RUNNING });
    expect(statusText()).toBe('Running on port 7420');
    expect(apiSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('says so when the API is on but not listening', () => {
    show({ status: { ...RUNNING, running: false } });
    expect(statusText()).toBe('On, but not running');
  });

  it('waits for the host before offering the switch', () => {
    show({ status: null });
    expect(statusText()).toBe('Checking…');
    expect(apiSwitch()).toHaveProperty('disabled', true);
  });

  it('shows why the last action failed', () => {
    show({ problem: 'cannot listen on 127.0.0.1: address in use' });
    expect(screen.getByRole('alert').textContent).toBe(
      'cannot listen on 127.0.0.1: address in use',
    );
  });

  it('turns the API on from the switch', async () => {
    const { onEnable } = show({ status: OFF });
    await userEvent.click(apiSwitch());
    expect(onEnable).toHaveBeenCalledWith(true);
  });

  it('holds every control while an action is under way', () => {
    show({ pending: true });
    expect(apiSwitch()).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Copy token' })).toHaveProperty('disabled', true);
  });

  it('copies the token', async () => {
    const { onCopyToken } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(onCopyToken).toHaveBeenCalledOnce();
  });

  it('asks before rotating the token, and rotates only once confirmed', async () => {
    const { onRotateToken } = show();

    await userEvent.click(screen.getByRole('button', { name: 'Rotate token…' }));
    expect(onRotateToken).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }));

    expect(onRotateToken).toHaveBeenCalledOnce();
  });

  it('rotates nothing when the confirmation is cancelled', async () => {
    const { onRotateToken } = show();

    await userEvent.click(screen.getByRole('button', { name: 'Rotate token…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRotateToken).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rotate token…' })).toBeDefined();
  });

  it('shows the MCP command and copies it', async () => {
    const { onCopyMcpCommand } = show();
    expect(screen.getByText('claude mcp add atlas -- node /x/main.js')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Copy MCP command' }));
    expect(onCopyMcpCommand).toHaveBeenCalledOnce();
  });

  it('says the path needs filling in when it is only a placeholder', () => {
    show({}, true);
    expect(screen.getByText(/Replace the path/)).toBeDefined();
  });

  it('does not ask for a path it already has', () => {
    show({}, false);
    expect(screen.queryByText(/Replace the path/)).toBeNull();
  });

  it('shows where the connection file is', () => {
    show({ status: RUNNING });
    expect(screen.getByText('/Users/j/api.json').tagName).toBe('CODE');
  });

  it('says what the last action did', () => {
    show({ notice: 'Token copied' });
    expect(screen.getByText('Token copied')).toBeDefined();
  });

  it('closes from its Close button', async () => {
    const { onClose } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
