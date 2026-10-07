/** Words that read wrong in sentence case. */
const ACRONYMS: ReadonlySet<string> = new Set(['id', 'url', 'api', 'sql']);

/**
 * A frontmatter key as a label a person reads: `blocked_by` is "Blocked by",
 * `dueDate` is "Due date", `id` is "ID".
 *
 * Only for keys a type gives no `label` to — a declared label is the vault's
 * own wording and always wins.
 */
export function humanizeKey(key: string): string {
  const words = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase())
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word));
  const [first, ...rest] = words;
  if (first === undefined) return key;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}
