/**
 * The one error a query refuses with.
 *
 * It lives on its own so that every part of the compiler — including the
 * vocabulary modules the compiler imports — can throw it without the two
 * importing each other.
 */
export class InvalidQueryError extends Error {
  constructor(reason: string) {
    super(`Invalid query: ${reason}`);
    this.name = 'InvalidQueryError';
  }
}
