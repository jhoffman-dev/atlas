import { useState } from 'react';
import {
  editedPayload,
  noteTitle,
  payloadFields,
  propertyText,
  proposalHeadline,
  type PayloadFields,
  type ProposalKind,
  type ProposalNote,
} from '@atlas/domain';
import { Icon } from '../icon.tsx';

const KIND_LABEL: Readonly<Record<ProposalKind, string>> = {
  task: 'Task',
  'follow-up': 'Follow-up',
  decision: 'Decision',
  person: 'Person',
  link: 'Link',
  term: 'Term',
  project: 'Project',
};

export interface ProposalCardProps {
  readonly proposal: ProposalNote;
  /** While any proposal is being answered. */
  readonly busy: boolean;
  /** Why the last answer to this one was refused. */
  readonly problem: string | null;
  /** Accepts it, with its payload as edited when it was. */
  readonly onAccept: (payload?: unknown) => void;
  readonly onReject: () => void;
  readonly onOpen: () => void;
  readonly onOpenSource: (link: string) => void;
}

/**
 * One proposal: what it would write, the line it cites, how sure its maker
 * was, and the answers — Accept, Edit (change what it writes, then accept)
 * and Reject.
 */
export function ProposalCard(props: ProposalCardProps) {
  const { proposal, busy, problem } = props;
  const [fields, setFields] = useState<PayloadFields | null>(null);
  const headline = proposalHeadline(proposal);
  return (
    <section className="proposal-card" aria-label={`${KIND_LABEL[proposal.kind]}: ${headline}`}>
      <header className="proposal-card__head">
        <span className="proposal-card__kind">{KIND_LABEL[proposal.kind]}</span>
        <span className="proposal-card__title">{headline}</span>
        {proposal.confidence !== null && (
          <span
            className={`proposal-card__confidence proposal-card__confidence--${proposal.confidence}`}
          >
            {proposal.confidence} confidence
          </span>
        )}
      </header>
      <Provenance {...props} />
      {fields === null ? (
        <Payload proposal={proposal} />
      ) : (
        <PayloadForm fields={fields} onChange={setFields} />
      )}
      {problem !== null && (
        <p className="proposal-card__problem" role="alert">
          {problem}
        </p>
      )}
      <footer className="proposal-card__actions">
        {fields === null ? (
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={props.onReject}
            >
              Reject
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => setFields(payloadFields(proposal))}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => props.onAccept()}
            >
              Accept
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => setFields(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => props.onAccept(editedPayload(proposal, fields))}
            >
              Accept as edited
            </button>
          </>
        )}
      </footer>
    </section>
  );
}

/** Where it came from: the line it cites — or a flag that it cites none — and what made it. */
function Provenance({ proposal, onOpen, onOpenSource }: ProposalCardProps) {
  return (
    <p className="proposal-card__provenance">
      {proposal.source === null ? (
        <span className="proposal-card__uncited">Cites no source</span>
      ) : (
        <button
          type="button"
          className="proposal-card__source"
          onClick={() => proposal.source !== null && onOpenSource(proposal.source)}
        >
          <Icon name="link" size={13} />
          {proposal.source}
        </button>
      )}
      {proposal.madeBy !== null && <span className="proposal-card__maker">{proposal.madeBy}</span>}
      <button type="button" className="proposal-card__file" onClick={onOpen}>
        Open proposal
      </button>
    </p>
  );
}

/** What Accept would write, as it stands. */
function Payload({ proposal }: { proposal: ProposalNote }) {
  if (proposal.kind === 'link') {
    const { note, property, link } = proposal.payload;
    return (
      <p className="proposal-card__change">
        Adds {link} to <b>{property}</b> of {noteTitle(note)}.
      </p>
    );
  }
  const { properties, body } = proposal.payload;
  const entries = Object.entries(properties);
  return (
    <>
      {entries.length > 0 && (
        <dl className="proposal-card__props" aria-label="What it would write">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{propertyText(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {body !== '' && <p className="proposal-card__body">{body}</p>}
    </>
  );
}

/** The payload's fields, to change before accepting. */
function PayloadForm({
  fields,
  onChange,
}: {
  fields: PayloadFields;
  onChange: (fields: PayloadFields) => void;
}) {
  if (fields.kind === 'link') {
    return (
      <div className="proposal-card__form">
        <label>
          Link
          <input
            value={fields.link}
            onChange={(event) => onChange({ ...fields, link: event.target.value })}
          />
        </label>
      </div>
    );
  }
  const setProperty = (at: number, text: string) =>
    onChange({
      ...fields,
      properties: fields.properties.map(([key, value], index) => [
        key,
        index === at ? text : value,
      ]),
    });
  return (
    <div className="proposal-card__form">
      <label>
        Title
        <input
          value={fields.title}
          onChange={(event) => onChange({ ...fields, title: event.target.value })}
        />
      </label>
      {fields.properties.map(([key, value], at) => (
        <label key={key}>
          {key}
          <input value={value} onChange={(event) => setProperty(at, event.target.value)} />
        </label>
      ))}
      <label>
        Body
        <textarea
          value={fields.body}
          rows={3}
          onChange={(event) => onChange({ ...fields, body: event.target.value })}
        />
      </label>
    </div>
  );
}
