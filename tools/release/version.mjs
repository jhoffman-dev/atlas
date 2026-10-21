#!/usr/bin/env node
// The app's version across the repo (issue #481). The rules are in
// versions.ts; this only finds the files, reads them and writes them.
//
//   node tools/release/version.mjs set <x.y.z | major | minor | patch>
//   node tools/release/version.mjs check [--tag <v-tag>]
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cargoCrateName,
  disagreements,
  nextVersion,
  readVersion,
  tagMismatch,
  writeVersion,
} from './versions.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TAURI = 'apps/desktop/src-tauri';

/** Every workspace package's package.json, under the folders pnpm-workspace.yaml names. */
function workspacePackages() {
  return ['apps', 'packages'].flatMap((folder) =>
    readdirSync(join(ROOT, folder), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${folder}/${entry.name}/package.json`)
      .filter((path) => existsSync(join(ROOT, path))),
  );
}

function load(path, kind) {
  return { path, kind, text: readFileSync(join(ROOT, path), 'utf8') };
}

/** The source of truth, then every file that copies it. */
function versionFiles() {
  return [
    load('package.json', 'package-json'),
    ...workspacePackages().map((path) => load(path, 'package-json')),
    load(`${TAURI}/tauri.conf.json`, 'tauri-conf'),
    load(`${TAURI}/Cargo.toml`, 'cargo-toml'),
    load(`${TAURI}/Cargo.lock`, 'cargo-lock'),
  ];
}

function crateName(files) {
  return cargoCrateName(files.find((file) => file.kind === 'cargo-toml'));
}

function set(request) {
  if (request === undefined) throw new Error('usage: version:set <x.y.z | major | minor | patch>');
  const files = versionFiles();
  const crate = crateName(files);
  const version = nextVersion(readVersion(files[0], crate), request);
  for (const file of files)
    writeFileSync(join(ROOT, file.path), writeVersion(file, version, crate));
  console.log(`version ${version} written to ${files.length} files`);
}

function check(tag) {
  const files = versionFiles();
  const crate = crateName(files);
  const version = readVersion(files[0], crate);
  const problems = disagreements(files, version, crate).map(
    ({ path, found }) => `${path} has ${found ?? 'no version'}, package.json has ${version}`,
  );
  const tagProblem = tag === undefined ? null : tagMismatch(tag, version);
  if (tagProblem !== null) problems.push(tagProblem);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error('Run `pnpm version:set <version>` to put them back in step.');
    process.exit(1);
  }
  console.log(
    `version ${version} in all ${files.length} files${tag ? `, and the tag ${tag}` : ''}`,
  );
}

function tagArgument(args) {
  if (args.length === 0) return undefined;
  if (args[0] !== '--tag' || args[1] === undefined)
    throw new Error('usage: version:check [--tag <tag>]');
  return args[1];
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'set') set(rest[0]);
  else if (command === 'check') check(tagArgument(rest));
  else throw new Error(`unknown command "${command ?? ''}": use set or check`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
