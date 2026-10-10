import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * The mapper's modules in the order a single script needs them: each after
 * what it uses. An n8n Code node is one script with no imports, so the
 * modules are joined into it.
 */
const MODULES = [
  'meeting-mapping-error.ts',
  'meeting-stated.ts',
  'meeting-when.ts',
  'meeting-attendees.ts',
  'meeting-text.ts',
  'meeting-sections.ts',
  'meeting-transcript.ts',
  'meeting-file-name.ts',
  'meeting-to-atlas.ts',
] as const;

const IMPORT = /^import\s[^;]*;[ \t]*\n?/gm;
const EXPORT = /^export\s+(?=(async\s+)?(function|class|const|let)\b)/gm;
const EMPTY_EXPORT = /^export\s*\{\s*\};?[ \t]*\n?/gm;

/** The names a module exports as values (types leave nothing behind in JavaScript). */
function exportedValues(source: ts.SourceFile): string[] {
  const exported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((each) => each.kind === ts.SyntaxKind.ExportKeyword);
  return source.statements.filter(exported).flatMap((statement) => {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      return statement.name === undefined ? [] : [statement.name.text];
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.map((each) => each.name.getText(source));
    }
    return [];
  });
}

/**
 * One module as a block of the script: its code in a scope of its own, so
 * its private names cannot meet another module's, handing out what it exports.
 */
function moduleScript(name: string): string {
  const text = readFileSync(new URL(name, import.meta.url), 'utf8');
  const names = exportedValues(ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true));
  const { outputText } = ts.transpileModule(text, {
    fileName: name,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const code = outputText.replace(IMPORT, '').replace(EMPTY_EXPORT, '').replace(EXPORT, '');
  const list = names.join(', ');
  return `// ${name}\nconst { ${list} } = (() => {\n${code}return { ${list} };\n})();\n`;
}

const HEADER = [
  '// Atlas meeting mapper (meeting-import contract v1).',
  '// Generated from tools/n8n/*.ts in the Atlas repo by `pnpm n8n:build`:',
  '// change those files and rebuild rather than editing here.',
].join('\n');

/** The mapper as one plain-JavaScript script, followed by `run`, the node's own lines. */
function codeNodeScript(run: string): string {
  return `${HEADER}\n\n${MODULES.map(moduleScript).join('\n')}\n// --- n8n ---\n${run}\n`;
}

/** The "Map meeting to Atlas file" node: run once for each item, one file per meeting. */
export const MAP_MEETING_NODE = 'Map meeting to Atlas file';

/** James's zone: an instant (`...Z`) is read on this clock unless OPTIONS says otherwise. */
export const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

export function mapMeetingScript(): string {
  return codeNodeScript(
    [
      '// timeZone: the zone a date-time ending in Z or an offset (an instant) is read in.',
      '// A date or time without one is kept as written. null refuses instants.',
      '// groupAddresses: list addresses (e.g. "eng@example.com") that are groups but whose',
      '// local part does not say team/group/all/list/staff (joined by - or _).',
      `const OPTIONS = { timeZone: '${DEFAULT_TIME_ZONE}', groupAddresses: [] };`,
      'return { json: mapMeeting($json, OPTIONS) };',
    ].join('\n'),
  );
}

/** The "Same meeting?" node: is the file GitHub found at the path this meeting? */
export function sameMeetingScript(): string {
  return codeNodeScript(
    [
      `const meeting = $('${MAP_MEETING_NODE}').item.json;`,
      'const duplicate = sameMeeting(existingFileText($json), meeting);',
      'return { json: { ...meeting, duplicate } };',
    ].join('\n'),
  );
}

/** The "Same meeting at the other path?" node: passes this meeting on to the skip, or fails. */
export function sameMeetingAtOtherPathScript(): string {
  return codeNodeScript(
    [
      `const meeting = $('${MAP_MEETING_NODE}').item.json;`,
      'return { json: { ...meeting, duplicate: sameMeetingAtOtherPath($json, meeting) } };',
    ].join('\n'),
  );
}
