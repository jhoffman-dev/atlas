/**
 * Adversarial: #162's migration of shipped properties into built-in type
 * files, through the real YAML reader and writer, over a vault in memory
 * whose host refuses a write to a file that moved on since it was read.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  parentVaultPath,
  parseShippedPropertiesRecord,
  shippedPropertiesRecordText,
  splitFrontmatter,
  type VaultEntry,
} from '@atlas/domain';
import { ensureBuiltInTypes, loadObjectTypes, type VaultFsPort } from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

function memoryHost(initial: Record<string, string>) {
  const files = new Map<string, { text: string; modified: number }>(
    Object.entries(initial).map(([path, text]) => [path, { text, modified: 1 }]),
  );
  let clock = 1;
  const folders = new Set<string>();
  const hasFolder = (folder: string) =>
    folder === '' ||
    folders.has(folder) ||
    [...files.keys()].some((p) => p.startsWith(`${folder}/`));
  const failing = new Set<string>();
  const fs: VaultFsPort = {
    listDirectory: async (folder) => {
      if (failing.has(folder)) throw new Error('Operation timed out');
      if (!hasFolder(folder)) throw new Error('no such folder');
      const names = new Map<string, VaultEntry>();
      const prefix = folder === '' ? '' : `${folder}/`;
      for (const path of [...files.keys(), ...folders]) {
        if (!path.startsWith(prefix) || path === folder) continue;
        const [first = '', ...more] = path.slice(prefix.length).split('/');
        const at = createVaultPath(`${prefix}${first}`);
        names.set(
          first,
          more.length > 0 || folders.has(at)
            ? ({ kind: 'directory', name: first, path: at } as VaultEntry)
            : ({ kind: 'file', name: first, path: at, modified: 0, size: 0 } as VaultEntry),
        );
      }
      return [...names.values()];
    },
    listNotes: async () => [],
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const file = files.get(path);
        return file === undefined ? [] : [{ path, ...file, size: file.text.length }];
      }),
    readTextFile: async (path) => {
      const file = files.get(path);
      if (file === undefined) throw new Error(`no such file: ${path}`);
      return file;
    },
    readBinaryFile: async () => new ArrayBuffer(0),
    createNote: async ({ path, contents }) => {
      if (files.has(path)) throw new Error('something with that name is already there');
      if (!hasFolder(parentVaultPath(path))) throw new Error('that folder does not exist');
      files.set(path, { text: contents, modified: ++clock });
    },
    createFolder: async ({ path }) => {
      if (hasFolder(path)) throw new Error('something with that name is already there');
      folders.add(path);
    },
    moveEntry: async () => {},
    trashEntry: async () => {},
    writeTextFile: async ({ path, contents, expectedModified }) => {
      const file = files.get(path);
      if (file === undefined) throw new Error(`no such file: ${path}`);
      if (expectedModified !== null && expectedModified !== file.modified) {
        throw new Error(`${path} changed since it was read`);
      }
      files.set(path, { text: contents, modified: ++clock });
      return clock;
    },
    writeBinaryFile: async () => 0,
  };
  const text = (path: string) => files.get(path)?.text ?? '';
  const set = (path: string, contents: string) =>
    files.set(path, { text: contents, modified: ++clock });
  return { fs, markdown: remarkMarkdown, text, set, files, failing };
}

/** The type file's frontmatter as YAML reads it. */
const frontmatterOf = (text: string) =>
  remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter);

describe('#162 migration, on a type file whose `properties` is not a map', () => {
  it('never overwrites a hand-written list of properties with Atlas’s map', async () => {
    const meeting = [
      '---',
      'name: meeting',
      'label: Meeting',
      'properties:',
      '  - title',
      '  - attendees',
      '---',
      '',
      '# Meeting',
      '',
    ].join('\n');
    const v = memoryHost({ '.atlas/types/meeting.md': meeting });

    await ensureBuiltInTypes(v);

    // What the person wrote under `properties` is theirs; Atlas could not read
    // it, so it must not be replaced. Additive only (shippedPropertiesPlan's contract).
    expect(v.text('.atlas/types/meeting.md')).toContain('  - title\n  - attendees\n');
  });

  it('never overwrites a scalar `properties` value with Atlas’s map', async () => {
    const daily = [
      '---',
      'name: daily',
      'properties: see the Daily note in Resources',
      '---',
      '',
    ].join('\n');
    const v = memoryHost({ '.atlas/types/daily.md': daily });

    await ensureBuiltInTypes(v);

    expect(v.text('.atlas/types/daily.md')).toContain('see the Daily note in Resources');
  });
});

describe('#162 migration, on two type files that both name the Meeting type', () => {
  it('gives tasks to the Meeting type Accept and the Claude step read, not to another file', async () => {
    // Mara Quill's vault, synced between two Macs: her Meeting type and the
    // sync's conflict copy of it, both `name: meeting`.
    const meeting = (label: string) =>
      ['---', 'name: meeting', `label: ${label}`, 'properties:', '  title: text', '---', ''].join(
        '\n',
      );
    const v = memoryHost({
      '.atlas/types/meeting.md': meeting('Meeting'),
      '.atlas/types/meeting 2.md': meeting('Meeting (conflict copy)'),
    });

    await ensureBuiltInTypes(v);

    // accept-proposal.ts:249, claude-step.ts:513 and linked-sections.ts:82 take
    // the FIRST type whose folded name is `meeting`; Accept links through its `tasks`.
    const types = await loadObjectTypes(v);
    const read = types.find((type) => type.name.trim().toLowerCase() === 'meeting');
    expect(read?.properties.map((property) => property.key)).toContain('tasks');
  });
});

describe('#162 migration, through the real YAML writer', () => {
  it('leaves the lines of the properties the file already had exactly as written', async () => {
    const indented = [
      '---',
      'name: meeting',
      'properties: # Mara’s own',
      '    title:',
      '        kind: text',
      '        label: >-',
      '            What the',
      '            call was',
      '    when: date',
      '---',
      '',
    ].join('\n');
    const v = memoryHost({ '.atlas/types/meeting.md': indented });

    await ensureBuiltInTypes(v);

    // "only the properties added are written, after the file's own, and its
    // body and every key it had stay as they were" (add-shipped-properties.ts).
    const kept = indented.slice(0, indented.indexOf('---\n', 4));
    expect(v.text('.atlas/types/meeting.md').startsWith(kept)).toBe(true);
  });

  it('adds no key of its own making beside a key the file wrote with spaces around it', async () => {
    const spaced = [
      '---',
      'name: meeting',
      'properties:',
      '  " title": text',
      '  when: date',
      '---',
      '',
    ].join('\n');
    const v = memoryHost({ '.atlas/types/meeting.md': spaced });

    await ensureBuiltInTypes(v);

    const keys = Object.keys(
      (frontmatterOf(v.text('.atlas/types/meeting.md'))['properties'] ?? {}) as object,
    );
    // Only shipped keys may appear that were not there; `title: null` is not one.
    expect(keys).not.toContain('title');
  });
});

describe('#162 migration, when its record is there but cannot be listed', () => {
  it('does not put back a key the person took off because a listing failed', async () => {
    const v = memoryHost({ '.atlas/types/meeting.md': '---\nname: meeting\n---\n' });
    await ensureBuiltInTypes(v);
    // Mara takes `tasks` off her Meeting type: it is settled, so it stays off.
    const without = '---\nname: meeting\nproperties:\n  title: text\n---\n';
    v.set('.atlas/types/meeting.md', without);
    // The next open, the host fails to list the migrations folder (not "no such folder").
    v.failing.add('.atlas/migrations');

    await ensureBuiltInTypes(v);

    expect(v.text('.atlas/types/meeting.md')).toBe(without);
  });
});

describe('#162 migration, when the vault is opened twice at once', () => {
  // React StrictMode (apps/desktop/src/main.tsx) runs useBuiltInTypes' effect
  // twice in development; the first run is only marked cancelled, not stopped.
  it('reports no failure for a type the other open just gave the properties', async () => {
    const meeting = ['---', 'name: meeting', 'properties:', '  title: text', '---', ''].join('\n');
    const v = memoryHost({ '.atlas/types/meeting.md': meeting });

    const [first, second] = await Promise.all([ensureBuiltInTypes(v), ensureBuiltInTypes(v)]);

    expect([...first.properties.failed, ...second.properties.failed]).toEqual([]);
  });
});

describe('#162 record, as another tool may save it', () => {
  it('reads back a record whose line endings were turned to CRLF', () => {
    const written = shippedPropertiesRecordText({
      settled: { meeting: ['tasks', 'decisions'] },
      added: {},
    });

    expect(() => parseShippedPropertiesRecord(written.replace(/\n/g, '\r\n'))).not.toThrow();
  });
});
