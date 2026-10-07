import { CommitField } from './commit-field.tsx';
import { SettingsCard } from './settings-card.tsx';

/**
 * Settings → Profile: who uses this vault. Claude in Atlas writes this name
 * wherever a note needs the person's, and writes a placeholder without one.
 */
export function ProfileSettings({
  name,
  preferredName,
  placeholder,
  problem,
  disabled,
  onName,
  onPreferredName,
}: {
  /** The full name; '' when none is set. */
  name: string;
  /** What the person goes by; '' when none is set. */
  preferredName: string;
  /** What Claude writes in place of a name it was not given. */
  placeholder: string;
  /** Why the name cannot be read or was not saved. */
  problem: string | null;
  /** The names are not read yet, or cannot be: neither field can be changed. */
  disabled: boolean;
  onName: (name: string) => void;
  onPreferredName: (preferredName: string) => void;
}) {
  return (
    <SettingsCard id="settings-profile" icon="person" title="Profile">
      <p className="settings__lede">
        Claude in Atlas uses your name wherever a note needs it — an owner, an author, an attendee.
        It is kept in this vault’s settings, so every Mac that syncs the vault has it.
      </p>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Full name</span>
          <span className="settings__status">
            {disabled
              ? 'Not read yet: Claude asks for your name'
              : name === ''
                ? `Not set: Claude writes “${placeholder}” rather than guess one`
                : 'What Claude writes for you'}
          </span>
        </span>
        <CommitField
          value={name}
          label="Full name"
          className="settings__field"
          placeholder="Your full name"
          disabled={disabled}
          onCommit={onName}
        />
      </div>
      <div className="settings__row">
        <span className="settings__row-text">
          <span className="settings__row-label">Preferred name</span>
          <span className="settings__status">What you go by, if it is not your first name</span>
        </span>
        <CommitField
          value={preferredName}
          label="Preferred name"
          className="settings__field"
          placeholder="Optional"
          disabled={disabled}
          onCommit={onPreferredName}
        />
      </div>
      {problem !== null && (
        <p className="settings__problem" role="alert">
          {problem}
        </p>
      )}
    </SettingsCard>
  );
}
