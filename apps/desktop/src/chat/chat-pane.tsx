import { ChatPanel, ClaudeSettings, type ChatNameHint } from '@atlas/ui';
import { DEFAULT_CHAT_MODEL } from '@atlas/domain';
import type { ChatController } from './use-chat.ts';

/** The chat panel, wired to its controller. */
export function ChatPane({
  chat,
  onFollowLink,
  loadImage,
  nameHint,
}: {
  chat: ChatController;
  onFollowLink: (target: string) => void;
  loadImage: (src: string) => Promise<string | null>;
  /** Offered while Settings → Profile has no name; null once it has one. */
  nameHint: ChatNameHint | null;
}) {
  const { session } = chat;
  return (
    <ChatPanel
      state={chat.state}
      model={chat.model}
      problem={chat.problem}
      history={chat.history}
      loadImage={loadImage}
      nameHint={nameHint}
      actions={{
        onSend: (text) => void session.send(text),
        onStop: () => session.stop(),
        onRetry: () => void session.retry(),
        onNewChat: () => session.newChat(),
        onClose: chat.close,
        onRemoveContext: () => session.removeContext(),
        onAccept: (id) => void session.accept(id),
        onReject: (id) => session.reject(id),
        onUndo: (id) => void session.undo(id),
        onCopy: chat.copy,
        onFollowLink,
      }}
    />
  );
}

/** Settings → Claude, wired to where the choice is kept. */
export function ClaudeSettingsCard({ chat }: { chat: ChatController }) {
  return (
    <ClaudeSettings
      provider={chat.settings.provider}
      model={chat.settings.model}
      defaultModel={DEFAULT_CHAT_MODEL}
      problem={chat.problem}
      onProvider={(provider) => chat.setSettings({ ...chat.settings, provider })}
      onModel={(model) => chat.setSettings({ ...chat.settings, model })}
    />
  );
}
