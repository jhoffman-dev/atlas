import { useState, type FormEvent } from 'react';
import { SettingsCard } from './settings-card.tsx';

/** One secret as Settings shows it. There is no value here to show. */
export interface SecretRow {
  readonly name: string;
  /** The sources that name it, as their titles. */
  readonly usedBy: readonly string[];
  /** False for a name a source uses that this Mac's Keychain does not hold. */
  readonly stored: boolean;
  /** The sites it may be sent to; empty when it is sent nowhere yet. */
  readonly origins: readonly string[];
}

/** A value to store; `sites` as typed, left out to keep where it is sent. */
export interface SecretSave {
  readonly name: string;
  readonly value: string;
  readonly sites?: string;
}

/** Resolves true once the change landed, false when it was refused. */
type Saving<T> = (change: T) => Promise<boolean>;

/**
 * Settings → Secrets: the names a source can refer to as `{{secret:name}}`,
 * which sources do, where each may be sent, and a way to set, replace, rebind
 * or remove each.
 *
 * A value is typed into a masked field and handed on; the field is emptied
 * once the save has landed, and nothing on this card ever holds one to show.
 * Which names and sites are usable is the application's to say, as `problem`.
 */
export function SecretsSettings({
  secrets,
  problem,
  pending,
  onSave,
  onBind,
  onDelete,
}: {
  secrets: readonly SecretRow[];
  problem: string | null;
  pending: boolean;
  onSave: Saving<SecretSave>;
  onBind: Saving<{ name: string; sites: string }>;
  onDelete: (name: string) => void;
}) {
  return (
    <SettingsCard id="settings-secrets" icon="key" title="Secrets">
      <p className="settings__lede">
        Tokens a source sends, kept in this Mac’s Keychain and never in the vault. A source names
        one as <code>{'{{secret:name}}'}</code>, or with <code>auth: {'{ secret: name }'}</code>.
        Each is sent only to the sites you give it.
      </p>
      {secrets.length === 0 ? (
        <p className="settings__lede secrets__empty">No secrets yet.</p>
      ) : (
        <ul className="secrets__list" aria-label="Secrets">
          {secrets.map((secret) => (
            <SecretItem
              key={secret.name}
              secret={secret}
              pending={pending}
              onSave={onSave}
              onBind={onBind}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
      <AddSecret pending={pending} onSave={onSave} />
      {problem !== null && (
        <p className="settings__problem" role="alert">
          {problem}
        </p>
      )}
    </SettingsCard>
  );
}

function usage(secret: SecretRow): string {
  const sources = secret.usedBy.join(', ');
  if (!secret.stored) return `Used by ${sources} — not set on this Mac`;
  return secret.usedBy.length === 0 ? 'Not used by any source' : `Used by ${sources}`;
}

function destination(secret: SecretRow): string {
  return secret.origins.length === 0
    ? 'Sent nowhere until you choose the sites it is for'
    : `Sent only to ${secret.origins.join(', ')}`;
}

type Mode = 'idle' | 'replacing' | 'binding' | 'deleting';

function SecretItem({
  secret,
  pending,
  onSave,
  onBind,
  onDelete,
}: {
  secret: SecretRow;
  pending: boolean;
  onSave: Saving<SecretSave>;
  onBind: Saving<{ name: string; sites: string }>;
  onDelete: (name: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const done = () => setMode('idle');
  const closeOnSuccess = (saved: boolean) => {
    if (saved) done();
    return saved;
  };

  return (
    <li className="secrets__item" data-stored={secret.stored}>
      <div className="secrets__row">
        <span className="secrets__text">
          <code className="secrets__name">{secret.name}</code>
          <span className="secrets__usage">{usage(secret)}</span>
          {secret.stored && (
            <span className="secrets__usage" data-bound={secret.origins.length > 0}>
              {destination(secret)}
            </span>
          )}
        </span>
        {mode === 'idle' && <ItemActions secret={secret} pending={pending} onMode={setMode} />}
      </div>
      {mode === 'replacing' && (
        <ValueForm
          name={secret.name}
          askSites={!secret.stored}
          pending={pending}
          onCancel={done}
          onSubmit={(change) => onSave({ name: secret.name, ...change }).then(closeOnSuccess)}
        />
      )}
      {mode === 'binding' && (
        <SitesForm
          name={secret.name}
          current={secret.origins}
          pending={pending}
          onCancel={done}
          onSubmit={(sites) => onBind({ name: secret.name, sites }).then(closeOnSuccess)}
        />
      )}
      {mode === 'deleting' && (
        <ConfirmDelete
          secret={secret}
          onCancel={done}
          onConfirm={() => {
            done();
            onDelete(secret.name);
          }}
        />
      )}
    </li>
  );
}

function ItemActions({
  secret,
  pending,
  onMode,
}: {
  secret: SecretRow;
  pending: boolean;
  onMode: (mode: Mode) => void;
}) {
  return (
    <span className="settings__actions">
      <button
        className="btn btn--tinted btn--sm"
        type="button"
        disabled={pending}
        onClick={() => onMode('replacing')}
      >
        {secret.stored ? 'Replace…' : 'Set…'}
      </button>
      {secret.stored && (
        <button
          className="btn btn--tinted btn--sm"
          type="button"
          disabled={pending}
          onClick={() => onMode('binding')}
        >
          Sites…
        </button>
      )}
      {secret.stored && (
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          disabled={pending}
          aria-label={`Delete ${secret.name}`}
          onClick={() => onMode('deleting')}
        >
          Delete
        </button>
      )}
    </span>
  );
}

function ConfirmDelete({
  secret,
  onCancel,
  onConfirm,
}: {
  secret: SecretRow;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="settings__confirm" role="group" aria-label={`Delete ${secret.name}?`}>
      <p className="settings__lede">
        {secret.usedBy.length === 0
          ? 'It is removed from the Keychain.'
          : `${secret.usedBy.join(', ')} will fail to refresh until it is set again.`}
      </p>
      <div className="settings__actions">
        <button className="btn btn--primary btn--sm" type="button" onClick={onConfirm}>
          Delete
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A masked value, and for a secret not yet held the sites it is for. */
function ValueForm({
  name,
  askSites,
  pending,
  onSubmit,
  onCancel,
}: {
  name: string;
  askSites: boolean;
  pending: boolean;
  onSubmit: (change: { value: string; sites?: string }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [sites, setSites] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(askSites ? { value, sites } : { value });
  };

  return (
    <form className="secrets__form" onSubmit={submit}>
      <SecretValueField
        label={`New value for ${name}`}
        value={value}
        onChange={setValue}
        autoFocus
      />
      {askSites && (
        <SitesField label={`Sites ${name} may be sent to`} value={sites} onChange={setSites} />
      )}
      <div className="settings__actions">
        <button className="btn btn--primary btn--sm" type="submit" disabled={pending}>
          Save
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Where a stored secret may be sent, starting from where it goes now. */
function SitesForm({
  name,
  current,
  pending,
  onSubmit,
  onCancel,
}: {
  name: string;
  current: readonly string[];
  pending: boolean;
  onSubmit: (sites: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [sites, setSites] = useState(current.join(', '));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(sites);
  };

  return (
    <form className="secrets__form" onSubmit={submit}>
      <SitesField
        label={`Sites ${name} may be sent to`}
        value={sites}
        onChange={setSites}
        autoFocus
      />
      <div className="settings__actions">
        <button className="btn btn--primary btn--sm" type="submit" disabled={pending}>
          Save
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddSecret({ pending, onSave }: { pending: boolean; onSave: Saving<SecretSave> }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [sites, setSites] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({ name, value, sites }).then((saved) => {
      if (!saved) return;
      setValue('');
      setName('');
      setSites('');
    });
  };

  return (
    <form className="secrets__form secrets__add" aria-label="Add a secret" onSubmit={submit}>
      <input
        className="field secrets__field"
        aria-label="Secret name"
        placeholder="Name, e.g. github"
        autoComplete="off"
        spellCheck={false}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <SecretValueField label="Secret value" value={value} onChange={setValue} />
      <SitesField label="Sites it may be sent to" value={sites} onChange={setSites} />
      <button
        className="btn btn--tinted btn--sm"
        type="submit"
        disabled={pending || name.trim() === '' || value === '' || sites.trim() === ''}
      >
        Add
      </button>
    </form>
  );
}

/** Where the sites a secret is for are typed: one or more, by comma or space. */
function SitesField({
  label,
  value,
  onChange,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      className="field secrets__field"
      aria-label={label}
      placeholder="Sent to, e.g. api.github.com"
      autoComplete="off"
      spellCheck={false}
      autoFocus={autoFocus}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Where a value is typed: masked, and kept out of autofill, the spelling
 * dictionary and the password manager's offer to save it.
 */
function SecretValueField({
  label,
  value,
  onChange,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      className="field secrets__field"
      type="password"
      aria-label={label}
      placeholder="Value"
      autoComplete="new-password"
      spellCheck={false}
      autoFocus={autoFocus}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
