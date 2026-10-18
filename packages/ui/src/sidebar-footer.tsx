import type { ReactNode } from 'react';
import { Icon } from './icon.tsx';
import { ThemeSwitch } from './theme-switch.tsx';
import type { ThemeStore } from './theme.ts';

/**
 * The foot of the sidebar, above a hairline: Settings, how sync stands when
 * the vault syncs, and the sun-or-moon theme button.
 */
export function SidebarFooter({
  themeStore,
  onOpenSettings,
  sync = null,
}: {
  themeStore: ThemeStore;
  onOpenSettings: () => void;
  /** The sync light, for a vault that syncs; null for one that does not. */
  sync?: ReactNode;
}) {
  return (
    <div className="sidebar-footer">
      <button
        className="sidebar-footer__settings"
        type="button"
        onClick={onOpenSettings}
        title="Settings (⌘,)"
      >
        <Icon name="gear" className="sidebar__icon" />
        Settings
      </button>
      {sync}
      <ThemeSwitch store={themeStore} />
    </div>
  );
}
