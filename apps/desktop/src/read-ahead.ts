/**
 * How long after the vault settles an Inbox offer is read ahead of the Inbox
 * opening (#130): the index ready and nothing that the read depends on
 * changing for this long. A walk of the vault then never competes with
 * whatever the person does the moment the vault is open.
 */
export const READ_AHEAD_DELAY_MS = 500;

/**
 * Reads an offer now while the Inbox is open — the person is waiting on it —
 * or `READ_AHEAD_DELAY_MS` later while it is not. Returns what stops a read
 * not yet begun.
 */
export function readAhead(open: boolean, read: () => void): () => void {
  if (open) {
    read();
    return () => {};
  }
  const timer = setTimeout(read, READ_AHEAD_DELAY_MS);
  return () => clearTimeout(timer);
}
