import { CommitField } from '../commit-field.tsx';
import { SegmentedControl, type SegmentedOption } from '../segmented-control.tsx';
import { SettingsCard } from '../settings-card.tsx';
import type { ChatProblemView } from './chat-view.ts';

export type ClaudeProviderChoice = 'claude-code' | 'anthropic-api';

const PROVIDERS: readonly SegmentedOption<ClaudeProviderChoice>[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'anthropic-api', label: 'API key' },
];

/**
 * Settings → Claude: which way the chat reaches the model, and which model.
 * Claude Code uses the login it already has; Atlas never sees it.
 */
export function ClaudeSettings({
  provider,
  model,
  defaultModel,
  problem,
  onProvider,
  onModel,
}: {
  provider: ClaudeProviderChoice;
  model: string;
  defaultModel: string;
  /** Why the chosen way cannot be used now; null when it can, or before it is known. */
  problem: ChatProblemView | null;
  onProvider: (provider: ClaudeProviderChoice) => void;
  onModel: (model: string) => void;
}) {
  return (
    <SettingsCard id="settings-claude" icon="spark" title="Claude">
      <p className="settings__lede">
        The chat (⌘J) talks to Claude through the Claude Code you installed and logged into, so
        Atlas never holds your login. Or use an API key kept in the Keychain as the secret
        “anthropic”, for the site api.anthropic.com.
      </p>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Reach Claude through</span>
          <span className="settings__status">
            {problem === null ? 'Ready' : problem.message}
            {problem !== null && problem.fix !== null && (
              <>
                {' '}
                <code>{problem.fix}</code>
              </>
            )}
          </span>
        </span>
        <SegmentedControl
          label="Reach Claude through"
          options={PROVIDERS}
          value={provider}
          onChange={onProvider}
        />
      </div>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Model</span>
          <span className="settings__status">Blank for {defaultModel}</span>
        </span>
        <CommitField
          value={model}
          label="Model"
          className="settings__field"
          placeholder={defaultModel}
          onCommit={onModel}
        />
      </div>
    </SettingsCard>
  );
}
