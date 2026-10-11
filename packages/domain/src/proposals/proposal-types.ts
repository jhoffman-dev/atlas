import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { PERSON_TYPE } from '../people/person.ts';
import type { PropertyDef } from '../types/property-def.ts';
import type { BuiltInTypeFile } from '../types/para.ts';
import {
  DECISION_TYPE,
  PROPOSAL_ANSWERERS,
  PROPOSAL_CONFIDENCES,
  PROPOSAL_KINDS,
  PROPOSAL_STATES,
  PROPOSAL_TYPE,
} from './proposal.ts';

const property = (
  key: string,
  kind: PropertyDef['kind'],
  label: string,
  more: Partial<PropertyDef> = {},
): PropertyDef => ({
  key,
  kind,
  label,
  required: false,
  options: [],
  target: null,
  many: false,
  ...more,
});

/**
 * The Proposal and Decision types, as written into a vault that lacks them
 * (P29-02): what the Inbox's proposals are notes of, and what an accepted
 * decision proposal makes. The same definitions this repository's vault ships.
 */
export const PROPOSAL_TYPE_FILES: readonly BuiltInTypeFile[] = [
  {
    type: {
      name: PROPOSAL_TYPE,
      label: 'Proposal',
      properties: [
        property('kind', 'select', 'Kind', { options: [...PROPOSAL_KINDS], required: true }),
        property('state', 'select', 'State', { options: [...PROPOSAL_STATES], required: true }),
        property('confidence', 'select', 'Confidence', { options: [...PROPOSAL_CONFIDENCES] }),
        property('source', 'text', 'Cites'),
        property('made_by', 'text', 'Made by'),
        property('answered_via', 'select', 'Answered in', { options: [...PROPOSAL_ANSWERERS] }),
      ],
    },
    body: [
      '# Proposal',
      '',
      'Something Claude or an automation suggests, waiting in `Inbox/Proposals/` for you',
      'to accept, edit or reject it on the Inbox page. Nothing it proposes is written',
      'until it is accepted.',
      '',
    ].join('\n'),
  },
  {
    type: {
      name: DECISION_TYPE,
      label: 'Decision',
      properties: [
        property('title', 'text', 'Title'),
        property('date', 'date', 'Date'),
        property('meeting', 'relation', 'Meeting', { target: MEETING_TYPE }),
        property('project', 'relation', 'Project', { target: 'project' }),
        property('people', 'relation', 'People', { target: PERSON_TYPE, many: true }),
        property('source', 'text', 'Cites'),
      ],
    },
    body: [
      '# Decision',
      '',
      'Something decided — usually in a meeting — kept as its own note. Accepting a',
      'decision proposal makes one.',
      '',
    ].join('\n'),
  },
];
