/**
 * How a narrow window folds the shell (brief §4): the right sidebar collapses
 * first, then the left. The widths are the brief's — 224px sidebar, 300px
 * aside (`--aside-width`) — plus the least the work in between can live with.
 *
 * That least is set by the window itself: it is never narrower than 720px
 * (tauri.conf.json), and e2e/shell.attack-332.spec.ts holds every bar tidy
 * there with the sidebar open, so 720 − 224 is the work's floor. Which is why
 * the left sidebar never folds by width: the window cannot get narrower than
 * what the sidebar fits in, so "then the left" has no width to fire at. Only
 * the aside collapses, and this is the one rule for when.
 *
 * shell.css draws it as media queries; collapse.test.ts holds the two to the
 * same numbers. Slice 8b reads this to know what the window is showing (the
 * toggle's pressed state, where the focus may go) without measuring.
 */
export const SIDEBAR_WIDTH = 224;
export const ASIDE_WIDTH = 300;
/** The window's own minimum width, which the left sidebar is sized to fit in. */
export const WINDOW_MIN_WIDTH = 720;
export const LEAST_WORK_WIDTH = WINDOW_MIN_WIDTH - SIDEBAR_WIDTH;

/** Under this width the aside collapses, while the left sidebar is open. */
export const ASIDE_COLLAPSES_BELOW = SIDEBAR_WIDTH + ASIDE_WIDTH + LEAST_WORK_WIDTH;
/** Under this width the aside collapses even with the left sidebar hidden by hand. */
export const ASIDE_COLLAPSES_BELOW_ALONE = ASIDE_WIDTH + LEAST_WORK_WIDTH;

export function collapseFor({
  width,
  sidebarOpen,
}: {
  width: number;
  /** Whether the left sidebar is open, by the user's choice. */
  sidebarOpen: boolean;
}): { aside: boolean } {
  const aside = width < (sidebarOpen ? ASIDE_COLLAPSES_BELOW : ASIDE_COLLAPSES_BELOW_ALONE);
  return { aside };
}
