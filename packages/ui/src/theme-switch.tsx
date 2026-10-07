import { SegmentedControl, type SegmentedOption } from './segmented-control.tsx';
import { useTheme, type Theme, type ThemeStore } from './theme.ts';

const THEMES: readonly SegmentedOption<Theme>[] = [
  { value: 'light', label: 'Light theme', icon: 'sun' },
  { value: 'dark', label: 'Dark theme', icon: 'moon' },
];

/**
 * Light or dark, as a sun and a moon in a pill, remembered for next time.
 *
 * A radio group rather than a switch: the two themes are peers, not "dark" and
 * "not dark", and a pair of icons says which one is on at a glance.
 */
export function ThemeSwitch({ store }: { store: ThemeStore }) {
  const { theme, setTheme } = useTheme(store);
  return (
    <SegmentedControl
      label="Theme"
      options={THEMES}
      value={theme}
      onChange={setTheme}
      tone="quiet"
    />
  );
}
