import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  isProposalNote,
  isProposalPath,
  payloadRecord,
  proposalHeadline,
  proposedWriteRefusal,
  readProposal,
  readProposalPayload,
  type ProposalNote,
} from './proposal.ts';

const path = createVaultPath('Inbox/Proposals/Send the payroll file.md');

const TASK = {
  type: 'proposal',
  kind: 'task',
  state: 'open',
  confidence: 'high',
  source: '[[2026-10-01 Standup#^t0003]]',
  made_by: 'after-meeting · 2026-10-01T10:02',
  payload: {
    title: 'Send Mara the payroll file',
    properties: { status: 'next', meeting: '[[2026-10-01 Standup]]' },
  },
};

const LINK = {
  type: 'proposal',
  kind: 'link',
  payload: {
    note: 'People/Mara Quill.md',
    property: 'company',
    link: '[[Larkspur Payroll]]',
    digest: '0badf00d',
  },
};

function read(properties: Record<string, unknown>): ProposalNote {
  const reading = readProposal({ path, properties });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

function problemOf(properties: Record<string, unknown>): string {
  const reading = readProposal({ path, properties });
  if (reading.ok) throw new Error('read');
  return reading.problem;
}

describe('readProposal', () => {
  it('reads a task proposal: its kind, state, confidence, source, maker and payload', () => {
    expect(read(TASK)).toEqual({
      path,
      kind: 'task',
      state: 'open',
      confidence: 'high',
      source: '[[2026-10-01 Standup#^t0003]]',
      madeBy: 'after-meeting · 2026-10-01T10:02',
      payload: {
        title: 'Send Mara the payroll file',
        folder: null,
        body: '',
        properties: { status: 'next', meeting: '[[2026-10-01 Standup]]' },
      },
    });
  });

  it('reads a proposal with no state as open, and an unknown confidence as none', () => {
    const unstated: Record<string, unknown> = { ...TASK };
    delete unstated['state'];
    expect(read({ ...unstated, confidence: 'certain' })).toMatchObject({
      state: 'open',
      confidence: null,
    });
  });

  it('reads kind and state in any case, and an empty source as none', () => {
    expect(read({ ...TASK, kind: ' Follow-Up ', state: 'REJECTED', source: '  ' })).toMatchObject({
      kind: 'follow-up',
      state: 'rejected',
      source: null,
    });
  });

  it('reads a link proposal: the note, the relation, the link and what the note held', () => {
    expect(read(LINK)).toMatchObject({
      kind: 'link',
      payload: {
        note: 'People/Mara Quill.md',
        property: 'company',
        link: '[[Larkspur Payroll]]',
        digest: '0badf00d',
      },
    });
  });

  it.each([
    [{ ...TASK, kind: 'meeting' }, /no kind Atlas knows: task, decision, follow-up/],
    [{ ...TASK, kind: undefined }, /no kind/],
    [{ ...TASK, state: 'pending' }, /state is not one of open, accepted, rejected/],
    [{ ...TASK, payload: 'Send it' }, /payload does not say what to write/],
    [{ ...TASK, payload: [] }, /payload does not say what to write/],
    [{ ...TASK, payload: { title: ' / ' } }, /needs a title/],
    [{ ...TASK, payload: { title: 'X', properties: ['status'] } }, /keys and values/],
    [{ ...TASK, payload: { title: 'X', properties: { ' ': 1 } } }, /has no name/],
    [{ ...TASK, payload: { title: 'X', body: 3 } }, /body must be text/],
    [{ ...TASK, payload: { title: 'X', folder: '.atlas/views' } }, /hidden configuration/],
    [{ ...TASK, payload: { title: 'X', folder: 'Archive/Old' } }, /in the Archive/],
    [{ ...TASK, payload: { title: 'X', folder: 'archive' } }, /in the Archive/],
    [{ ...TASK, payload: { title: 'X', folder: 'inbox/proposals' } }, /where proposals wait/],
    [{ ...TASK, payload: { title: 'X', folder: '../Elsewhere' } }, /not a path inside the vault/],
    [{ ...LINK, payload: { ...LINK.payload, digest: '' } }, /needs the note, the property/],
    [{ ...LINK, payload: { ...LINK.payload, link: 'Larkspur Payroll' } }, /not a link to a note/],
    [{ ...LINK, payload: { ...LINK.payload, link: '![[Logo.png]]' } }, /not a link to a note/],
    [{ ...LINK, payload: { ...LINK.payload, note: 'People/Mara.pdf' } }, /is not a note/],
    [{ ...LINK, payload: { ...LINK.payload, note: '.atlas/settings.md' } }, /hidden/],
    [{ ...LINK, payload: { ...LINK.payload, note: '/etc/hosts.md' } }, /not a path inside/],
  ])('refuses %j, saying why', (properties, problem) => {
    expect(problemOf(properties as Record<string, unknown>)).toMatch(problem);
  });

  it('keeps a folder it may write in, without a trailing slash', () => {
    expect(read({ ...TASK, payload: { title: 'X', folder: 'Work/Tasks/' } }).payload).toMatchObject(
      {
        folder: 'Work/Tasks',
      },
    );
  });
});

describe('readProposalPayload', () => {
  it('holds an edited payload to the same rules as the proposal’s own', () => {
    expect(readProposalPayload('decision', { title: '' })).toEqual({
      ok: false,
      problem: 'Its payload needs a title.',
    });
    expect(readProposalPayload('decision', { title: 'Ship on Friday' })).toMatchObject({
      ok: true,
    });
  });
});

describe('isProposalPath', () => {
  it('is a note in Inbox/Proposals, however it is cased', () => {
    expect(isProposalPath('Inbox/Proposals/X.md')).toBe(true);
    expect(isProposalPath('inbox/PROPOSALS/X.md')).toBe(true);
  });

  it('is not a note elsewhere in the Inbox, or archived from the folder', () => {
    expect(isProposalPath('Inbox/X.md')).toBe(false);
    expect(isProposalPath('Archive/Inbox/Proposals/X.md')).toBe(false);
    expect(isProposalPath('Inbox/Proposals.md')).toBe(false);
  });
});

describe('isProposalNote', () => {
  it('is a note whose type is proposal', () => {
    expect(isProposalNote({ type: ' Proposal ' })).toBe(true);
    expect(isProposalNote({ type: 'task' })).toBe(false);
    expect(isProposalNote({})).toBe(false);
  });
});

describe('proposedWriteRefusal', () => {
  it('lets a proposal write anywhere in user space', () => {
    expect(proposedWriteRefusal(createVaultPath('Tasks/Call.md'))).toBeNull();
    expect(proposedWriteRefusal(createVaultPath('Inbox/Call.md'))).toBeNull();
  });

  it('refuses a dot-folder at any depth', () => {
    expect(proposedWriteRefusal(createVaultPath('Work/.git/x.md'))).toMatch(/hidden/);
  });
});

describe('proposalHeadline', () => {
  it('is a note proposal’s title', () => {
    expect(proposalHeadline(read(TASK))).toBe('Send Mara the payroll file');
  });

  it('says which note a link goes on, through what, to what', () => {
    expect(proposalHeadline(read(LINK))).toBe('Mara Quill · company → [[Larkspur Payroll]]');
  });
});

describe('payloadRecord', () => {
  it('writes back only what a note payload holds', () => {
    expect(payloadRecord(read({ ...TASK, payload: { title: 'Call Tobias' } }).payload)).toEqual({
      title: 'Call Tobias',
    });
    expect(
      payloadRecord(
        read({ ...TASK, payload: { title: 'X', folder: 'Work', body: 'B', properties: { a: 1 } } })
          .payload,
      ),
    ).toEqual({ title: 'X', folder: 'Work', body: 'B', properties: { a: 1 } });
  });

  it('writes back a link payload whole', () => {
    expect(payloadRecord(read(LINK).payload)).toEqual(LINK.payload);
  });
});
