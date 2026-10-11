import { describe, expect, it } from 'vitest';
import { MAX_NAME_BYTES, utf8Bytes } from '../vault/file-name-bytes.ts';
import { createVaultPath, vaultPathName } from '../vault/vault-path.ts';
import { isUserSpaceNote } from '../vault/vault-visibility.ts';
import { applyProposal } from './apply-proposal.ts';
import { readProposal, type ProposalNote } from './proposal.ts';
import { editedPayload, payloadFields } from './proposal-edit.ts';

/**
 * Adversarial pass on P29-02 (#15): what a proposal may write, and what the
 * Edit form hands back when nothing in it was changed.
 */

const path = createVaultPath('Inbox/Proposals/Call Tobias.md');

function proposal(properties: Record<string, unknown>): ProposalNote {
  const reading = readProposal({ path, properties: { type: 'proposal', ...properties } });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const taskWith = (payload: Record<string, unknown>) =>
  proposal({ kind: 'task', payload: { title: 'Call Tobias', ...payload } });

describe('a proposal writes only in user space', () => {
  // `proposedWriteRefusal` checks dot-folders, the Archive and the proposals
  // folder, but not the rest of `isUserSpaceNote`: `node_modules` is a folder
  // the host's walk never reads, so a note made there is invisible to James and
  // to the duplicate check — and the API route promises a user-space note.
  it.each(['node_modules', 'Node_Modules', 'Projects/node_modules'])(
    'refuses a note proposal whose folder is %s, which the vault never shows',
    (folder) => {
      const made = proposal({ kind: 'task', payload: { title: 'Call Tobias', folder } });
      const applied = applyProposal(made, { notePaths: [], target: null });
      const written = applied.ok ? applied.writes.map((write) => write.path) : [];
      expect(written.filter((at) => !isUserSpaceNote(at))).toEqual([]);
    },
  );

  it('refuses a link proposal whose note is under node_modules', () => {
    const reading = readProposal({
      path,
      properties: {
        type: 'proposal',
        kind: 'link',
        payload: {
          note: 'node_modules/Mara Quill.md',
          property: 'company',
          link: '[[Larkspur Payroll]]',
          digest: '0badf00d',
        },
      },
    });
    expect(reading.ok).toBe(false);
  });
});

describe('a proposal makes a file name the disk takes', () => {
  // Elsewhere a name is cut with `fitFileNameStem`; a proposal's title is not,
  // so a long title (or a short one in a script of 3-byte characters) makes a
  // name APFS refuses, and Accept fails on the host's error, not a reason.
  it('keeps the new note’s file name within MAX_NAME_BYTES, or refuses with a reason', () => {
    const made = taskWith({ title: '会議の議事録から'.repeat(12) });
    const applied = applyProposal(made, { notePaths: [], target: null });
    const names = applied.ok ? applied.writes.map((write) => vaultPathName(write.path)) : [];
    expect(names.map(utf8Bytes).filter((bytes) => bytes > MAX_NAME_BYTES)).toEqual([]);
  });
});

describe('Accept as edited, with nothing in the form changed', () => {
  // Opening Edit and pressing "Accept as edited" — or changing only the title —
  // must write each property as the proposal holds it. Lists are split at
  // commas, and everything that is not a list, number or yes/no comes back as
  // the text the form showed, so these change shape silently.
  it.each([
    ['a list whose link holds a comma', ['[[Larkspur Payroll, Inc.]]', '[[Fenn & Co]]']],
    ['a list of numbers', [3, 5]],
    ['a record', { owner: '[[Mara Quill]]', hours: 2 }],
    ['no value', null],
  ])('writes back %s as it was', (_, value) => {
    const made = taskWith({ properties: { held: value } });
    const edited = editedPayload(made, payloadFields(made)) as {
      properties: Record<string, unknown>;
    };
    expect(edited.properties['held']).toEqual(value);
  });

  it('keeps a comma-holding link whole when only the title was changed', () => {
    const made = taskWith({ properties: { companies: ['[[Larkspur Payroll, Inc.]]'] } });
    const fields = payloadFields(made);
    if (fields.kind !== 'note') throw new Error('not a note proposal');
    const edited = editedPayload(made, { ...fields, title: 'Call Tobias today' }) as {
      properties: Record<string, unknown>;
    };
    expect(edited.properties['companies']).toEqual(['[[Larkspur Payroll, Inc.]]']);
  });
});
