import { invoke } from '@tauri-apps/api/core';
import type { ActivityStore } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

const asError = (message: string) => new Error(message);

/**
 * The Activity log's files, which the host keeps in the app's data folder,
 * one per vault (`activity.rs`). It appends, reads and replaces the text it
 * is handed; what goes in it is decided in TypeScript.
 */
export const tauriActivityStore: ActivityStore = {
  append: ({ vault, text }) =>
    throughHost(invoke<number>('activity_append', { vault, text }), asError),
  read: ({ vault }) => throughHost(invoke<string>('activity_read', { vault }), asError),
  replace: async ({ vault, text }) => {
    await throughHost(invoke('activity_replace', { vault, text }), asError);
  },
};
