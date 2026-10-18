import { Icon } from './icon.tsx';
import { useTheme, type Theme, type ThemeStore } from './theme.ts';

const OTHER: Readonly<Record<Theme, Theme>> = { light: 'dark', dark: 'light' };

/**
 * Light or dark, as one sun-or-moon button in the sidebar's foot, remembered
 * for next time.
 *
 * The button shows the theme it would switch to and is named for it — "Switch
 * to dark theme" while light is on — so a screen reader hears what pressing
 * it does, not what the app already looks like. Matching the system is a
 * Settings row (slice 13f), not a third state here.
 */
export function ThemeSwitch({ store }: { store: ThemeStore }) {
  const { theme, setTheme } = useTheme(store);
  const next = OTHER[theme];
  const label = `Switch to ${next} theme`;
  return (
    <button
      className="icon-button sidebar-footer__theme"
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
    >
      <Icon name={next === 'dark' ? 'moon' : 'sun'} size={15} />
    </button>
  );
}
