/**
 * A row or a card asking to be peeked (slice 6b): its note, and every row's
 * note in the order the view shows them, read from the view's data rather
 * than the page — a row the virtualiser has not drawn is still a step away.
 */
export interface PeekRequest {
  readonly path: string;
  readonly order: readonly string[];
}
