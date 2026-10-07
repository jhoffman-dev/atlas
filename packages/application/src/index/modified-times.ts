import type { IndexPort } from './ports.ts';

/**
 * The index's modification time of every note, or none when it cannot be
 * asked: what a reader that keeps notes compares with to tell which changed.
 */
export async function modifiedTimes(index: IndexPort): Promise<Map<string, number>> {
  try {
    return new Map((await index.manifest()).map((entry) => [entry.path, entry.modified]));
  } catch {
    // The index is being built or cannot be opened: every note is read from its file instead.
    return new Map();
  }
}
