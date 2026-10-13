import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapGranolaNote } from '@atlas/domain';
import { codeNodeScript } from './code-node.ts';

/*
 * Adversarial (P28-09). ADR-0034's two writers of one Granola note are the
 * app's pull, in Tauri's macOS webview (JavaScriptCore), and n8n's Code node
 * (Node, V8); they must write the same bytes, or the vault gets a sync
 * conflict copy. The mapper's INSTANT pattern accepts strings whose reading
 * Date.parse leaves to the engine: lowercase `t`/`z` (RFC 3339 allows them;
 * JavaScriptCore answers NaN) and a 60th second (V8 answers NaN,
 * JavaScriptCore the next minute). Runs where macOS's `jsc` shell is.
 */

const JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc';
const OPTIONS = {
  timeZone: 'America/Los_Angeles',
  selfEmails: ['mara.quill@example.com'],
  groupAddresses: [],
};

const NOTE = {
  id: 'not_4kTq2mWxLp4Rz7',
  object: 'note',
  owner: { name: 'Mara Quill', email: 'mara.quill@example.com' },
  title: 'Larkspur Payroll renewal',
  web_url: 'https://notes.granola.ai/d/0b6c1d2e',
  attendees: [],
  summary_text: 'Agreed.',
  summary_markdown: null,
  private_notes_text: null,
  private_notes_markdown: null,
  // The recording started 25 minutes after the calendar's time.
  transcript: [
    {
      speaker: { source: 'speaker', name: 'Tobias Fenn' },
      text: 'Hello.',
      start_time: '2026-10-06T17:25:00Z',
      end_time: '2026-10-06T17:25:02Z',
    },
  ],
};

const scheduled = (start: string) => ({
  ...NOTE,
  calendar_event: {
    event_title: null,
    invitees: [],
    organiser: null,
    calendar_event_id: null,
    scheduled_start_time: start,
    scheduled_end_time: null,
  },
});

/** The compiled Code-node script run under JavaScriptCore, each note's file or refusal. */
function inJavaScriptCore(notes: readonly unknown[]): unknown[] {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-jsc-'));
  const script = codeNodeScript(
    `const OPTIONS = ${JSON.stringify(OPTIONS)};\nreturn mapGranolaNote($json, OPTIONS);`,
  );
  const driver = [
    `function mapInNode($json) {\n${script}\n}`,
    `const notes = ${JSON.stringify(notes)};`,
    'print(JSON.stringify(notes.map((note) => { try { return mapInNode(note); } catch (error) { return `${error.name}: ${error.message}`; } })));',
  ].join('\n');
  const file = join(dir, 'driver.js');
  writeFileSync(file, driver);
  return JSON.parse(execFileSync(JSC, [file], { encoding: 'utf8' })) as unknown[];
}

function inApp(note: unknown): unknown {
  try {
    return { ...mapGranolaNote(note, OPTIONS) };
  } catch (error) {
    return `${(error as Error).name}: ${(error as Error).message}`;
  }
}

describe.skipIf(!existsSync(JSC))('a Granola note mapped in the webview’s engine', () => {
  it.each([
    ['a lowercase t and z (RFC 3339 §5.6)', '2026-10-06t17:00:00z'],
    ['a 60th second', '2026-10-06T17:00:60Z'],
  ])('with %s is written byte for byte as Node writes it', (_, start) => {
    const note = scheduled(start);
    const [webview] = inJavaScriptCore([note]);
    expect(webview).toEqual(inApp(note));
  });
});
