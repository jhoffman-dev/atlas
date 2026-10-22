/**
 * Correcting a meeting's words as it is imported (P28-06), through the real
 * YAML reader and writer: the file comes back byte for byte but for the
 * corrected spellings and the lines the import adds after `atlas_import:`,
 * undo gives back the original body exactly, and the API reads the change
 * list as a note property. All names are made up.
 */
import { describe, expect, it } from 'vitest';
import {
  apiFixture,
  bodyOf,
  catchUpMeetings,
  CorrectionRefusedError,
  recordingActivity,
  undoMeetingTermCorrections,
} from '@dfai/application';
import { atlasQueryIndex } from '@dfai/application/testing/sqlite';
import { createVaultPath, splitFrontmatter } from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';

const PATH = 'Inbox/Meetings/2026-10-06 Larkspur Pay sync.md';
const CONTRACT_LINE = 'atlas_import: meeting/v1\n';

const FRONTMATTER = [
  '---',
  'type: meeting',
  'atlas_import: meeting/v1',
  'title: Larkspur Pay sync   # as Gemini named it',
  "date: '2026-10-06'",
  "start: '10:00'",
  'provider: gemini',
  "external_id: 'gemini-5c0ffee1'",
  'attendees:',
  '  - name: Mara Quill',
  '    email: mara.quill@example.com',
  'tags: [ meetings,  larkspur ]',
  '---',
  '',
].join('\n');

const BODY = [
  '# Lark Spur Pay sync',
  '',
  '## Summary',
  '',
  'Mara Quil  says  Lark Spur Pay’s go-live moves a week.\t^s1',
  '',
  '## Transcript',
  '',
  '**Mara Quil** [~00:00:00] Morning. `Lark Spur Pay` is the code name; LARK SPUR PAY ships. ^t0001',
  '',
  '**Tobias Fenn** [~00:00:05] See [[Lark Spur Pay]] and lark  spur pay. ^t0002',
  '',
].join('\r\n');

const CORRECTED_BODY = [
  '# Lark Spur Pay sync',
  '',
  '## Summary',
  '',
  'Mara Quill  says  Larkspur Pay’s go-live moves a week.\t^s1',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:00] Morning. `Lark Spur Pay` is the code name; Larkspur Pay ships. ^t0001',
  '',
  '**Tobias Fenn** [~00:00:05] See [[Lark Spur Pay]] and Larkspur Pay. ^t0002',
  '',
].join('\r\n');

const VOCABULARY_NOTES = {
  'Terms/Larkspur Pay.md':
    '---\ntype: term\nkind: product\nvariants:\n  - Lark Spur Pay\n  - LARK SPUR PAY\n  - lark spur pay\n---\n',
  'Terms/Mara Quill.md': '---\ntype: term\nkind: person\nvariants: [Mara Quil]\n---\n',
  // An alias links the person to an attendee; it is never used to correct the text.
  'People/Mara Quill.md': '---\ntype: person\naliases: [Mara Quil, Quill]\n---\n',
};

function vault(meeting: string) {
  const files = { ...VOCABULARY_NOTES, [PATH]: meeting };
  const api = apiFixture({
    files,
    markdown: remarkMarkdown,
    index: { query: atlasQueryIndex({ files, markdown: remarkMarkdown }) },
  });
  const ports = {
    fs: api.fs,
    index: api.deps.index,
    markdown: remarkMarkdown,
    editors: api.deps.movingNotes,
  };
  const text = () => api.files.get(PATH)?.text ?? '';
  return { api, ports, text };
}

async function imported(meeting = FRONTMATTER + BODY) {
  const opened = vault(meeting);
  await catchUpMeetings({
    ports: opened.ports,
    today: '2026-10-10',
    activity: recordingActivity(),
  });
  return opened;
}

describe('a meeting corrected on import, through the real YAML writer', () => {
  it('changes only the misheard words in the body, and adds its lines after atlas_import', async () => {
    const { text } = await imported();
    const [head, tail] = FRONTMATTER.split(CONTRACT_LINE) as [string, string];
    const { frontmatter, body } = splitFrontmatter(text());

    expect(body).toBe(CORRECTED_BODY);
    // Every byte of the frontmatter as it came, the import's lines between them.
    expect(text().startsWith(head + CONTRACT_LINE + 'atlas_import_outcome: imported\n')).toBe(true);
    expect(text().endsWith(tail + CORRECTED_BODY)).toBe(true);
    expect(remarkMarkdown.frontmatterProperties(frontmatter)).toMatchObject({
      atlas_import_outcome: 'imported',
      atlas_corrections: [
        { from: 'Mara Quil', to: 'Mara Quill', count: 2, blocks: ['s1', 't0001'] },
        { from: 'Lark Spur Pay', to: 'Larkspur Pay', count: 1, blocks: ['s1'] },
        { from: 'LARK SPUR PAY', to: 'Larkspur Pay', count: 1, blocks: ['t0001'] },
        { from: 'lark  spur pay', to: 'Larkspur Pay', count: 1, blocks: ['t0002'] },
      ],
    });
  });

  it('undoes to the original body, byte for byte, through what the YAML reader read back', async () => {
    const { ports, text } = await imported();

    await undoMeetingTermCorrections({ ports, path: createVaultPath(PATH) });

    const { frontmatter, body } = splitFrontmatter(text());
    expect(body).toBe(BODY);
    expect(remarkMarkdown.frontmatterProperties(frontmatter)).toMatchObject({
      atlas_corrections: 'undone',
    });
    expect(frontmatter).not.toContain('atlas_corrections_digest');
    expect(frontmatter).not.toContain('atlas_corrections_original_digest');
  });

  it('refuses to undo, writing nothing, when a recorded original word was edited by hand', async () => {
    const { ports, text, api } = await imported();
    const broken = text().replace(/from: Lark Spur Pay/, 'from: Lark Spur Payroll');
    expect(broken).not.toBe(text());
    api.files.set(PATH, {
      ...(api.files.get(PATH) as { text: string; modified: number }),
      text: broken,
    });

    await expect(
      undoMeetingTermCorrections({ ports, path: createVaultPath(PATH) }),
    ).rejects.toThrow(CorrectionRefusedError);
    expect(text()).toBe(broken);
  });

  it('refuses to undo, writing nothing, when the change list was edited by hand into nonsense', async () => {
    const { ports, text, api } = await imported();
    const broken = text().replace(/count: 2/, 'count: two');
    api.files.set(PATH, {
      ...(api.files.get(PATH) as { text: string; modified: number }),
      text: broken,
    });

    await expect(
      undoMeetingTermCorrections({ ports, path: createVaultPath(PATH) }),
    ).rejects.toThrow(CorrectionRefusedError);
    expect(text()).toBe(broken);
  });

  it('is read through GET /v1/notes/{path} as the meeting’s properties', async () => {
    const { api } = await imported();

    const response = await api.send({
      method: 'GET',
      path: `/v1/notes/${encodeURIComponent(PATH)}`,
    });

    const note = bodyOf(response)['note'] as { properties: Record<string, unknown> };
    expect(note.properties['atlas_corrections']).toEqual([
      expect.objectContaining({ from: 'Mara Quil', to: 'Mara Quill', count: 2 }),
      expect.objectContaining({ from: 'Lark Spur Pay', to: 'Larkspur Pay' }),
      expect.objectContaining({ from: 'LARK SPUR PAY' }),
      expect.objectContaining({ from: 'lark  spur pay' }),
    ]);
  });

  it('leaves a meeting with nothing misheard exactly as it came but for its stamp and the mark that it was read', async () => {
    const clean = FRONTMATTER + CORRECTED_BODY;
    const { text } = await imported(clean);

    expect(splitFrontmatter(text()).body).toBe(CORRECTED_BODY);
    expect(text()).toBe(
      clean.replace(
        'atlas_import: meeting/v1\n',
        'atlas_import: meeting/v1\natlas_import_outcome: imported\natlas_corrections: none\n',
      ),
    );
  });
});
