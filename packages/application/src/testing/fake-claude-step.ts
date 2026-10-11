import type { ClaudeStepPorts } from '../automations/claude-step.ts';
import type { ModelProvider, ProviderStatus } from '../chat/ports.ts';
import type { ChatToolbox } from '../chat/toolbox.ts';
import { fakeModel, type FakeModel, type ScriptedRound } from './fake-model.ts';

/** A tool a fake step's toolbox answers, and every call it was asked. */
export interface FakeToolCalls {
  readonly names: string[];
}

/**
 * What a rule's Claude step reaches, faked: a scripted model, a clock that
 * moves `stepMs` each time it is read, a toolbox that answers each named
 * tool with `read`, and a deadline the test aborts. Test support only.
 */
export function fakeClaudeStepPorts({
  rounds = [],
  status = { ready: true },
  model = 'claude-test',
  stepMs = 250,
  today = '2026-10-11',
}: {
  rounds?: readonly ScriptedRound[];
  status?: ProviderStatus;
  model?: string;
  stepMs?: number;
  today?: string;
} = {}): ClaudeStepPorts & {
  readonly model: () => string;
  readonly fake: FakeModel;
  readonly calls: FakeToolCalls;
  readonly deadlines: AbortController[];
} {
  const scripted = fakeModel(rounds);
  const provider: ModelProvider = { ...scripted, status: async () => status };
  const calls: FakeToolCalls = { names: [] };
  const deadlines: AbortController[] = [];
  let now = Date.parse(`${today}T09:00:00Z`);
  return {
    provider: () => provider,
    model: () => model,
    fake: scripted,
    calls,
    deadlines,
    clock: {
      now: () => (now += stepMs),
      today: () => today,
    },
    toolboxes: { reading: (tools) => readingToolbox(tools, calls) },
    deadline: () => {
      const controller = new AbortController();
      deadlines.push(controller);
      return controller.signal;
    },
  };
}

function readingToolbox(tools: readonly string[], calls: FakeToolCalls): ChatToolbox {
  return {
    specs: tools.map((name) => ({ name, description: name, inputSchema: { type: 'object' } })),
    run: async (call) => {
      calls.names.push(call.name);
      return {
        result: {
          callId: call.id,
          name: call.name,
          content: `read by ${call.name}`,
          isError: false,
        },
        proposal: null,
      };
    },
  };
}
