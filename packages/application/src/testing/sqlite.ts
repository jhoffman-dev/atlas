/**
 * Test support that runs SQL for real, through `node:sqlite`: an entry point
 * of its own, so the barrel the app is built from never reaches a Node
 * built-in a browser bundle cannot hold, and a client-side test importing
 * `@atlas/application` never loads it.
 */
export { atlasQueryIndex } from './query-index.ts';
