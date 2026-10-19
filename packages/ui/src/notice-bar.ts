/**
 * The classes of a notice bar (primitives.css): the bar itself, the names
 * its own component goes by, and `--open` while its preview shows under
 * the line.
 */
export function noticeBarClass(own: string, open = false): string {
  return `notice-bar ${own}${open ? ' notice-bar--open' : ''}`;
}
