// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiConnectionStatus, ApiSettingsPort } from '@atlas/application';
import { SettingsPanel } from './settings-panel.tsx';

/**
 * Settings → Connections against a host held in memory: the switch, the
 * token, and what the panel says after each.
 */

const FILE = '/Users/j/Library/Application Support/dev.jhoffman.atlas/api.json';

function fakeHost({ failToStart = null }: { failToStart?: string | null } = {}) {
  let status: ApiConnectionStatus = { enabled: false, port: null, running: false, file: FILE };
  let token = 'first-token';
  const settings: ApiSettingsPort = {
    status: vi.fn(async () => status),
    setEnabled: vi.fn(async (enabled: boolean) => {
      if (enabled && failToStart !== null) {
        status = { ...status, enabled: true };
        throw new Error(failToStart);
      }
      status = { ...status, enabled, running: enabled, port: enabled ? 7420 : status.port };
      return status;
    }),
    token: vi.fn(async () => token),
    rotateToken: vi.fn(async () => {
      token = 'second-token';
      return token;
    }),
  };
  const copied: string[] = [];
  const clipboard = { write: vi.fn(async (text: string) => void copied.push(text)) };
  return { settings, clipboard, copied };
}

function showSettings(host: ReturnType<typeof fakeHost>, mcpEntry: string | null = '/a/main.js') {
  render(
    <SettingsPanel
      ports={{ settings: host.settings, clipboard: host.clipboard, mcpEntry }}
      onClose={() => {}}
    />,
  );
}

const statusText = () => screen.getByTestId('api-status').textContent;

describe('Settings → Connections', () => {
  it('reads the status from the host as it opens', async () => {
    showSettings(fakeHost());
    await waitFor(() => expect(statusText()).toBe('Off'));
    expect(screen.getByText(FILE)).toBeDefined();
  });

  it('turns the API on, and shows the port it is running on', async () => {
    const host = fakeHost();
    showSettings(host);
    await waitFor(() => expect(statusText()).toBe('Off'));

    await userEvent.click(screen.getByRole('switch', { name: 'Local API' }));

    await waitFor(() => expect(statusText()).toBe('Running on port 7420'));
    expect(host.settings.setEnabled).toHaveBeenCalledWith(true);
  });

  it('says why the API could not start, and shows what the host holds after', async () => {
    const host = fakeHost({ failToStart: 'cannot listen on 127.0.0.1: address in use' });
    showSettings(host);
    await waitFor(() => expect(statusText()).toBe('Off'));

    await userEvent.click(screen.getByRole('switch', { name: 'Local API' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'cannot listen on 127.0.0.1: address in use',
    );
    await waitFor(() => expect(statusText()).toBe('On, but not running'));
  });

  it('says so when the host cannot be asked at all', async () => {
    const host = fakeHost();
    host.settings.status = async () => {
      throw new Error('the API is not available');
    };
    showSettings(host);

    expect((await screen.findByRole('alert')).textContent).toBe('the API is not available');
    expect(statusText()).toBe('Unknown');
  });

  it('copies the token the host holds', async () => {
    const host = fakeHost();
    showSettings(host);
    await waitFor(() => expect(statusText()).toBe('Off'));

    await userEvent.click(screen.getByRole('button', { name: 'Copy token' }));

    await screen.findByText('Token copied');
    expect(host.copied).toEqual(['first-token']);
  });

  it('rotates the token once confirmed, and copies the new one after', async () => {
    const host = fakeHost();
    showSettings(host);
    await waitFor(() => expect(statusText()).toBe('Off'));

    await userEvent.click(screen.getByRole('button', { name: 'Rotate token…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    await screen.findByText(/^Token rotated\./);
    await userEvent.click(screen.getByRole('button', { name: 'Copy token' }));

    await screen.findByText('Token copied');
    expect(host.settings.rotateToken).toHaveBeenCalledOnce();
    expect(host.copied).toEqual(['second-token']);
  });

  it('copies the MCP command for the server this app was built beside', async () => {
    const host = fakeHost();
    showSettings(host, '/Users/j/atlas/apps/mcp/dist/main.js');
    await waitFor(() => expect(statusText()).toBe('Off'));

    await userEvent.click(screen.getByRole('button', { name: 'Copy MCP command' }));

    await screen.findByText('MCP command copied');
    expect(host.copied).toEqual([
      'claude mcp add atlas -- node /Users/j/atlas/apps/mcp/dist/main.js',
    ]);
  });

  it('says why a copy failed', async () => {
    const host = fakeHost();
    host.clipboard.write.mockRejectedValue(new Error('clipboard access was denied'));
    showSettings(host);
    await waitFor(() => expect(statusText()).toBe('Off'));

    await userEvent.click(screen.getByRole('button', { name: 'Copy token' }));

    expect((await screen.findByRole('alert')).textContent).toBe('clipboard access was denied');
  });
});
