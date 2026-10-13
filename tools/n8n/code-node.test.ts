import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapGranolaNote } from '@atlas/domain';

/*
 * The mapper lives in the domain (#93) and is compiled from there into n8n's
 * Code nodes, which have no imports: the build joins the modules into one
 * script and drops their import lines. A module that imported from outside
 * its folder would leave a name undefined in n8n while every test here,
 * which loads the modules normally, still passed.
 */

const mapping = new URL('../../packages/domain/src/meetings/mapping/', import.meta.url);
const modules = readdirSync(mapping).filter(
  (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
);

describe('the mapper compiled into the Code nodes', () => {
  it.each(modules)('%s imports nothing but the mapper’s own modules', (name) => {
    const text = readFileSync(new URL(name, mapping), 'utf8');
    const sources = [...text.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((each) => each[1]);
    for (const source of sources) expect(source).toMatch(/^\.\/meeting-[a-z-]+\.ts$/);
  });

  it('is every module in the folder, so none is left out of the script', async () => {
    const { mapMeetingScript } = await import('./code-node.ts');
    const script = mapMeetingScript();
    for (const name of modules) expect(script).toContain(`// ${name}\n`);
  });
});

const granola = new URL('../../packages/domain/src/meetings/fixtures/granola/', import.meta.url);
const granolaNotes = readdirSync(granola).filter((name) => name.endsWith('.json'));
const OPTIONS = {
  timeZone: 'America/Los_Angeles',
  selfEmails: ['mara.quill@example.com'],
  groupAddresses: ['payroll-desk@example.com'],
};

describe('a Granola note mapped in a Code node', () => {
  /** The compiled modules, run as n8n runs a Code node: one script, `$json` its only input. */
  const run = async () => {
    const { codeNodeScript } = await import('./code-node.ts');
    const script = codeNodeScript(
      `const OPTIONS = ${JSON.stringify(OPTIONS)};\nreturn mapGranolaNote($json, OPTIONS);`,
    );
    return new Function('$json', script) as (json: unknown) => { content: string };
  };

  it.each(granolaNotes)('%s is written byte for byte as the app writes it', async (name) => {
    const note: unknown = JSON.parse(readFileSync(new URL(name, granola), 'utf8'));
    const app = mapGranolaNote(note, OPTIONS);
    expect((await run())(note)).toEqual({ ...app });
  });

  it('is refused there as it is in the app', async () => {
    const mapInNode = await run();
    expect(() => mapInNode({ id: 'not_4kTq2mWxLp4Rz7', title: 'No time' })).toThrow(/no start/);
  });
});
