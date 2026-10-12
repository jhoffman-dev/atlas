import type { ClaudeStepPorts, ModelProvider, Toolboxes } from '@atlas/application';
import { chatModelOrDefault } from '@atlas/domain';
import { localClock } from '../today.ts';
import type { ChatSettings, ChatSettingsStore } from './chat-settings-store.ts';
import type { ChatPorts } from './use-chat.ts';

/** The way of reaching Claude that Settings → Claude chose, for the vault open when asked. */
export function chosenProvider({
  settings,
  ports,
  vault,
}: {
  settings: ChatSettings;
  ports: ChatPorts;
  /** The open vault's root, read when the API provider asks for its key. */
  vault: () => string | null;
}): ModelProvider {
  return settings.provider === 'anthropic-api' ? ports.anthropicApi(vault) : ports.claudeCode;
}

/**
 * What a rule's Claude step reaches (P29-03): the chat's provider and model,
 * read from Settings as each run starts, the toolboxes the chat's is built
 * from, the person's clock, and the browser's timer for its time limit.
 */
export function claudeStepPorts({
  ports,
  store,
  toolboxes,
  vault,
  selfName,
}: {
  ports: ChatPorts;
  store: ChatSettingsStore;
  toolboxes: Pick<Toolboxes, 'reading'>;
  vault: () => string | null;
  /** The vault owner's name from their profile, read as each run starts; null when it holds none. */
  selfName: () => string | null;
}): ClaudeStepPorts {
  return {
    provider: () => chosenProvider({ settings: store.read(), ports, vault }),
    model: () => chatModelOrDefault(store.read().model),
    toolboxes,
    selfName,
    clock: localClock,
    deadline: (ms) => AbortSignal.timeout(ms),
  };
}
