import { memo } from 'react';
import { SettingsSection } from './settings-section.tsx';
import { SETTINGS_SECTIONS } from './settings-section-links.ts';
import { useTheme, type Theme, type ThemeStore } from './theme.ts';
import { Toggle } from './toggle.tsx';

const NAMED: Readonly<Record<Theme, string>> = { light: 'Light', dark: 'Dark' };

/**
 * Settings → Appearance: one row, "Match system". On, the app is light or
 * dark as macOS is and follows it; off, the theme is the one chosen with the
 * sidebar's sun-or-moon button, whatever macOS is set to. Turning it off
 * keeps what is showing, as a choice. Memoised: the store is the same object
 * for the app's life, and the row hears a change through it rather than
 * through the dialog redrawing as the host answers.
 */
export const AppearanceSettings = memo(function AppearanceSettings({
  store,
}: {
  store: ThemeStore;
}) {
  const { theme, matching, setTheme, matchSystem } = useTheme(store);
  return (
    <SettingsSection section={SETTINGS_SECTIONS.appearance}>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Match system</span>
          <span className="settings__status" data-testid="theme-status">
            {matching
              ? `${NAMED[theme]} now, as macOS is set.`
              : `${NAMED[theme]}, chosen with the sidebar’s theme button, whatever macOS is set to.`}
          </span>
        </span>
        <Toggle
          label="Match system"
          checked={matching}
          onChange={(match) => (match ? matchSystem() : setTheme(theme))}
        />
      </div>
    </SettingsSection>
  );
});
