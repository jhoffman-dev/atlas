import type { ReactNode } from 'react';
import type { ActivityLog, ApiSettingsPort } from '@atlas/application';
import { SettingsDialog } from '@atlas/ui';
import type { ClipboardWriter } from './clipboard.ts';
import { mcpAddCommand } from './mcp-command.ts';
import { useConnectionSettings } from './use-connection-settings.ts';

/** What Settings needs from the app around it. */
export interface SettingsPorts {
  readonly settings: ApiSettingsPort;
  readonly clipboard: ClipboardWriter;
  /** Where the MCP server was built, when this build knows; null otherwise. */
  readonly mcpEntry: string | null;
}

/** Settings, wired to the host. */
export function SettingsPanel({
  ports,
  activity,
  onClose,
  fallbackFocus,
  children,
}: {
  ports: SettingsPorts;
  /** Where a change to the connection that fails is recorded. */
  activity: Pick<ActivityLog, 'inOpenVault'>;
  onClose: () => void;
  fallbackFocus?: () => HTMLElement | null;
  /** Sections after Connections, which the app supplies. */
  children?: ReactNode;
}) {
  const connection = useConnectionSettings({ ...ports, activity });
  const mcp = mcpAddCommand(ports.mcpEntry);

  return (
    <SettingsDialog
      connection={connection}
      mcp={mcp}
      onEnable={connection.setEnabled}
      onCopyToken={connection.copyToken}
      onRotateToken={connection.rotateToken}
      onCopyMcpCommand={() =>
        connection.copyText({ text: mcp.command, notice: 'MCP command copied' })
      }
      onClose={onClose}
      {...(fallbackFocus ? { fallbackFocus } : {})}
    >
      {children}
    </SettingsDialog>
  );
}
