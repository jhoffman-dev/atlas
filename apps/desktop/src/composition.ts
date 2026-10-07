import { isTauri } from '@tauri-apps/api/core';
import {
  anthropicApiProvider,
  claudeCodeProvider,
  remarkMarkdown,
  tauriModelHttp,
  tauriModelProcess,
  tauriApiBridge,
  tauriApiSettings,
  tauriExternalLinks,
  tauriHttp,
  tauriSecrets,
  tauriSqliteSource,
  tauriPageSnapshot,
  tauriIndex,
  staticAppInfo,
  tauriAppInfo,
  tauriVaultFs,
  tauriVaultPicker,
  tauriVaultStore,
  tauriVaultWatch,
  tauriActivityStore,
  tauriWindowClosing,
  tauriGit,
  tauriGitFolders,
  tauriGitHub,
  tauriMacName,
  tauriSyncFiles,
} from '@atlas/adapters';
import type {
  ActivityStore,
  WindowClosingPort,
  AppInfoPort,
  ExternalLinkPort,
  PageSnapshotPort,
} from '@atlas/application';
import type { VaultPorts } from './vault/use-vault.ts';
import type { NotePorts } from './notes/use-note.ts';
import type { IndexPorts } from './index/use-index.ts';
import type { LocalApiPorts } from './api/use-local-api.ts';
import type { SourcePorts } from './sources/source-ports.ts';
import { browserClipboard } from './settings/clipboard.ts';
import type { OnHost } from './vault/bound-to-vault.ts';
import type { ChatPorts } from './chat/use-chat.ts';
import { browserMacId } from './sync/browser-mac-id.ts';
import { browserSyncPause } from './sync/browser-sync-pause.ts';
import type { SyncHostPorts } from './sync/use-sync.ts';

/**
 * The composition root: the one place allowed to know about every layer.
 * `pnpm dev` opens the UI in a plain browser, where no Tauri runtime answers.
 */
export function resolveAppInfoPort(): AppInfoPort {
  return isTauri() ? tauriAppInfo : staticAppInfo({ name: 'Atlas', version: '0.1.0' });
}

export function resolveVaultPorts(): OnHost<VaultPorts> {
  return {
    fs: tauriVaultFs,
    picker: tauriVaultPicker,
    store: tauriVaultStore,
    watch: tauriVaultWatch,
  };
}

export function resolveNotePorts(): OnHost<NotePorts> {
  return { fs: tauriVaultFs, markdown: remarkMarkdown };
}

export function resolveIndexPorts(): OnHost<IndexPorts> {
  return { fs: tauriVaultFs, index: tauriIndex, markdown: remarkMarkdown };
}

export function resolveSourcePorts(): SourcePorts {
  return { http: tauriHttp, sqlite: tauriSqliteSource, secrets: tauriSecrets };
}

export function resolveExternalLinks(): ExternalLinkPort {
  return tauriExternalLinks;
}

export function resolvePageSnapshot(): PageSnapshotPort {
  return tauriPageSnapshot;
}

export function resolveLocalApiPorts(): LocalApiPorts {
  return {
    bridge: tauriApiBridge,
    settings: tauriApiSettings,
    clipboard: browserClipboard,
    mcpEntry: builtMcpEntry(),
  };
}

/**
 * The MCP server beside the checkout this app was built from, which Vite writes
 * in at build time. Absent where nothing built it in — the unit tests — and then
 * Settings shows the README's placeholder instead.
 */
function builtMcpEntry(): string | null {
  return typeof __ATLAS_MCP_ENTRY__ === 'string' ? __ATLAS_MCP_ENTRY__ : null;
}

/**
 * Claude, the two ways (ADR-0021): the person's own Claude Code, which keeps
 * its login to itself, and the API with a key the host fills in from the
 * Keychain. Each run of Claude Code gets an id no other run has.
 */
export function resolveChatPorts(): ChatPorts {
  return {
    claudeCode: claudeCodeProvider(tauriModelProcess(() => crypto.randomUUID())),
    anthropicApi: (vault) =>
      anthropicApiProvider({ http: tauriModelHttp, secrets: tauriSecrets, vault }),
  };
}

/**
 * Sync through GitHub (U-29): the Mac's own git and gh, run by the host with
 * argument shapes it holds fixed, and this Mac's name for commits and copies.
 */
export function resolveSyncPorts(): SyncHostPorts {
  return {
    git: tauriGit,
    files: tauriSyncFiles,
    folders: tauriGitFolders,
    github: tauriGitHub,
    pause: browserSyncPause,
    thisMac: { name: tauriMacName.name, id: browserMacId(() => crypto.randomUUID()) },
  };
}

/**
 * Each vault's Activity log, kept by the host in the app's data folder (U-28),
 * and the window's close button, which waits for its last lines.
 */
export function resolveActivityPorts(): { store: ActivityStore; closing: WindowClosingPort } {
  return { store: tauriActivityStore, closing: tauriWindowClosing };
}
