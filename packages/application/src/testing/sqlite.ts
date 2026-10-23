/**
 * Test support that runs SQL for real, through `node:sqlite`: an entry point
 * of its own, so the barrel the app is built from never reaches a Node
 * built-in a browser bundle cannot hold, and a client-side test importing
 * `@dfai/application` never loads it. Each helper takes `DatabaseSync` from
 * `./node-sqlite.ts`, so a jsdom test can import this entry point too.
 */
export { atlasQueryIndex } from './query-index.ts';
export { automationVault } from './automation-vault.ts';
export { sqliteIndexPort } from './sqlite-index.ts';
