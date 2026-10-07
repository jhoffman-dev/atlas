import type { ActivityEvent, ActivityReport } from '@atlas/domain';
import type { ActivityLog, ActivityStore } from '../activity/ports.ts';

/** An Activity log that keeps what it is told, for a test to read back. */
export function recordingActivity(): ActivityLog & { readonly reports: ActivityReport[] } {
  const reports: ActivityReport[] = [];
  const recorder = { record: (report: ActivityReport) => void reports.push(report) };
  return {
    reports,
    ...recorder,
    inOpenVault: () => recorder,
    inVault: () => recorder,
    read: () => Promise.resolve<readonly ActivityEvent[]>([]),
    subscribe: () => () => undefined,
  };
}

/** The log's files held in memory, by vault, as the host's would be. */
export function memoryActivityStore(): ActivityStore & { readonly files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    append: async ({ vault, text }) => {
      files.set(vault, (files.get(vault) ?? '') + text);
      return new TextEncoder().encode(files.get(vault)).byteLength;
    },
    read: async ({ vault }) => files.get(vault) ?? '',
    replace: async ({ vault, text }) => void files.set(vault, text),
  };
}
