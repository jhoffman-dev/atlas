import { ApiError } from './api-error.ts';

/*
 * Reading a request's fields, refusing with `invalid` and the field's name
 * when one is not what the route needs. The body is JSON from anywhere, so
 * nothing about its shape is assumed.
 */

export type Fields = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The body as an object; anything else — null, an array, a string — is refused. */
export function bodyObject(body: unknown): Fields {
  if (!isRecord(body)) throw new ApiError('invalid', 'the body must be a JSON object');
  return body;
}

export function requiredString(fields: Fields, field: string): string {
  const value = fields[field];
  if (typeof value !== 'string') throw new ApiError('invalid', `${field} must be a string`);
  return value;
}

/** A string with something in it besides spaces. */
export function requiredText(fields: Fields, field: string): string {
  const value = requiredString(fields, field);
  if (value.trim() === '') throw new ApiError('invalid', `${field} must not be empty`);
  return value;
}

export function optionalString(fields: Fields, field: string): string | undefined {
  return fields[field] === undefined ? undefined : requiredString(fields, field);
}

export function optionalBoolean(fields: Fields, field: string): boolean | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ApiError('invalid', `${field} must be true or false`);
  return value;
}

export function optionalRecord(fields: Fields, field: string): Fields | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new ApiError('invalid', `${field} must be an object`);
  return value;
}

/** A modification time as a note reported it: a whole, non-negative number. */
export function optionalModified(fields: Fields, field: string): number | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError('invalid', `${field} must be the note's modified time, a whole number`);
  }
  return value;
}

export function optionalArray(fields: Fields, field: string): readonly unknown[] | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ApiError('invalid', `${field} must be an array`);
  return value;
}

/** A yes or no from a query string: `true` or `false`, false when not given. */
export function queryFlag(raw: string | undefined, field: string): boolean {
  if (raw === undefined || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new ApiError('invalid', `${field} must be true or false`);
}

/** Items to skip, from a query string: a whole number, 0 when not given. */
export function offsetOf(raw: string | undefined): number {
  if (raw === undefined) return 0;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new ApiError('invalid', 'offset must be a whole number, 0 or more');
  }
  return Number(raw);
}

/** A count from a query string or a body: a whole number from 1 to `max`. */
export function countOf(
  raw: unknown,
  { field, fallback, max }: { field: string; fallback: number; max: number },
): number {
  if (raw === undefined) return fallback;
  const count = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > max) {
    throw new ApiError('invalid', `${field} must be a whole number from 1 to ${max}`);
  }
  return count;
}
