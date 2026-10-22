/**
 * `node:sqlite`'s `DatabaseSync`, taken from the running Node rather than
 * imported. A test in a browser-like environment (jsdom) has its imports
 * resolved as a client's, which may load only the built-ins Node lists in
 * `builtinModules` — and Node 22, which CI runs, does not list `node:sqlite`.
 * Asked for at run time, it is never resolved, so the same SQL runs for real
 * in either environment on any Node with it (#525's CI failure).
 * Test support only.
 */
export const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
export type DatabaseSync = InstanceType<typeof DatabaseSync>;
