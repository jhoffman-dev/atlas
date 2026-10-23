import { messageWithoutPaths, type VaultPath } from '@dfai/domain';
import {
  AssistantEntityError,
  proposeMeetingTasks,
  proposeSpec,
  SpecRefusedError,
  type ProposedTasks,
} from '../assistant/index.ts';
import { ClaudeStepFailed, type ClaudeStepPorts } from '../automations/claude-step.ts';
import { ApiError } from './api-error.ts';
import { archivePorts } from './archive.ts';
import type { ApiProposedTasks } from './contract.ts';
import { bodyObject, requiredText } from './fields.ts';
import { isApiNotePath, notePathFrom } from './paths.ts';
import { spelledAsVault } from './vault-spelling.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * The assistant's two writes (P32-05), and both only propose: a meeting's
 * items drafted as proposals, and a dashboard or view spec checked and left
 * as one. Neither writes outside Inbox/Proposals; a dashboard or view is
 * written into `.atlas` only by Accept in the app (ADR-0016).
 */

/** What each proposal says made it. */
const MADE_BY = 'Claude, through the local API';

/**
 * How long the route waits for a meeting's draft before answering `202`:
 * under the host's 30 s, so a long meeting is not cut off as `timeout`. The
 * run goes on, and its proposals land in the Inbox all the same.
 */
export const PROPOSE_TASKS_WAIT_MS = 25_000;

/**
 * The meetings being drafted now, by vault and path: asking again while one
 * runs is refused rather than paying for a second answer. The app's one
 * process holds it, as it holds the panes.
 */
const drafting = new Set<string>();

/** `POST /v1/assistant/propose-tasks` `{ meeting }`: a meeting's items, as proposals. */
export async function proposeTasksRoute(request: VaultRequest): Promise<RouteResult> {
  const claude = request.claudeStep;
  if (claude === null) {
    throw new ApiError('conflict', 'DFAI cannot reach Claude yet: set it up in Settings → Claude.');
  }
  const meeting = await meetingOf(request);
  const key = `${request.vault}\n${meeting.normalize('NFC').toLowerCase()}`;
  if (drafting.has(key)) {
    throw new ApiError('conflict', `${meeting} is being drafted already; its proposals follow.`);
  }
  drafting.add(key);
  const run = proposeMeetingTasks({
    ports: archivePorts(request),
    claude,
    meeting,
    madeBy: MADE_BY,
  })
    .then(apiProposedTasks)
    .finally(() => drafting.delete(key));
  const answer = await within(run, claude);
  // Still running: what it proposes lands in the Inbox; a failure after this has no caller left to tell.
  if (answer === null) {
    return { status: 202, body: { proposingTasks: { meeting, running: true } } };
  }
  return { status: 200, body: { proposedTasks: answer } };
}

/** `POST /v1/assistant/make-dashboard` `{ spec }`: a dashboard or view, checked and proposed. */
export async function makeDashboardRoute(request: VaultRequest): Promise<RouteResult> {
  const { spec } = bodyObject(request.body);
  if (spec === undefined) throw new ApiError('invalid', 'spec must be given');
  try {
    const proposed = await proposeSpec({ ports: archivePorts(request), spec, madeBy: MADE_BY });
    request.assertStillOpen();
    return {
      status: 200,
      body: {
        proposedSpec: {
          kind: proposed.kind,
          title: proposed.title,
          proposal: proposed.proposal,
          problem: proposed.left?.reason ?? null,
        },
      },
    };
  } catch (error) {
    if (!(error instanceof SpecRefusedError)) throw error;
    throw new ApiError('invalid', `The spec was refused: ${error.message}`, {
      problems: error.problems,
    });
  }
}

/** The meeting the body names, as the vault spells it: a user-space `.md` note. */
async function meetingOf(request: VaultRequest): Promise<VaultPath> {
  const asked = notePathFrom(requiredText(bodyObject(request.body), 'meeting'), 'meeting');
  return spelledAsVault({ fs: request.fs, asked, accepts: isApiNotePath });
}

/**
 * The run's answer, or null once it has taken longer than the route waits.
 * A note that is no meeting, or a step that fails, is refused as the caller
 * can act on it.
 */
async function within(
  run: Promise<ApiProposedTasks>,
  claude: ClaudeStepPorts,
): Promise<ApiProposedTasks | null> {
  const waited = claude.deadline(PROPOSE_TASKS_WAIT_MS);
  const late = new Promise<null>((resolve) => {
    waited.addEventListener('abort', () => resolve(null), { once: true });
  });
  try {
    return await Promise.race([run, late]);
  } catch (error) {
    if (error instanceof AssistantEntityError) {
      throw new ApiError(error.reason === 'not_found' ? 'not_found' : 'invalid', error.message);
    }
    if (error instanceof ClaudeStepFailed) {
      throw new ApiError('conflict', `Claude could not draft it: ${messageWithoutPaths(error)}`);
    }
    throw error;
  }
}

function apiProposedTasks(drafted: ProposedTasks): ApiProposedTasks {
  return {
    meeting: drafted.meeting,
    proposed: drafted.proposed,
    alreadyProposed: drafted.alreadyProposed,
    dropped: drafted.dropped.map(({ title, reason }) => ({ title, reason })),
    left: drafted.left.map(({ path, reason }) => ({ path, reason })),
    warnings: drafted.warnings,
  };
}
