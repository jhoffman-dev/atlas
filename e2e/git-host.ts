import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** What `git_process.rs` hands back for one run. */
export interface GitOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * The prefix `git_process.rs` puts before every run (`FIXED_PREFIX`). The
 * host's own guards — the fixed argument shapes, finding the program, the
 * environment — are Rust's and are tested there; this stub runs the Mac's
 * real git with what the app asked for, so what a sync does to the files is
 * the real thing.
 */
const PREFIX = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.quotePath=false',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'color.ui=never',
  '-c',
  'commit.gpgSign=false',
  '-c',
  'tag.gpgSign=false',
  '-c',
  'merge.ff=true',
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.safecrlf=false',
  '-c',
  'merge.conflictStyle=merge',
  '-c',
  'merge.renames=true',
  '--literal-pathspecs',
  '--no-optional-locks',
];

/** The files `git_sync_file_*` may keep in a vault's `.git/atlas-sync/`. */
const SYNC_FILES = new Set(['journal.json', 'exclude']);

/** A home of its own, so no one's global git settings or identity reach the test. */
async function isolatedEnv(): Promise<NodeJS.ProcessEnv> {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'atlas-e2e-home-')));
  return {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C',
  };
}

/** Runs git as the host does, answering as it does: an exit code rather than a throw. */
export async function gitIn(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  try {
    const { stdout, stderr } = await run('git', [...PREFIX, ...args], { cwd, env });
    return { code: 0, stdout, stderr } satisfies GitOutput;
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    } satisfies GitOutput;
  }
}

/** One of the person's repositories, as `gh repo list --json …` lists it. */
export interface ListedRepository {
  name: string;
  nameWithOwner: string;
  defaultBranchRef: { name: string } | null;
  visibility: 'PRIVATE' | 'PUBLIC';
  url: string;
}

/**
 * GitHub, as the e2e suite sees it: `gh repo create` makes a bare repository
 * on disk and pushes to it, `gh repo list` lists the repositories a test
 * says the person has, and each clone or push goes to such a folder. The
 * other Mac is a clone of it, driven from the test.
 */
export async function createGitStub() {
  const env = await isolatedEnv();
  const remotes = await realpath(await mkdtemp(join(tmpdir(), 'atlas-e2e-github-')));
  let macName = 'Studio';
  let repositories: ListedRepository[] = [];
  /** A run of git the test holds until it lets go, by its verb (`fetch`, `push`). */
  const held = new Map<string, Promise<void>>();

  async function repoCreate(vaultRoot: string, name: string): Promise<GitOutput> {
    const bare = join(remotes, `${name}.git`);
    const made = await gitIn(
      remotes,
      ['init', '--quiet', '--bare', '--initial-branch=main', bare],
      env,
    );
    if (made.code !== 0) return made;
    const added = await gitIn(vaultRoot, ['remote', 'add', 'origin', bare], env);
    if (added.code !== 0) return added;
    return gitIn(vaultRoot, ['push', '--quiet', '--set-upstream', 'origin', 'HEAD'], env);
  }

  /** As the host does: git never looks above the vault, and reads the vault's own excludes. */
  async function inVault(root: string, args: readonly string[]): Promise<GitOutput> {
    const verb = args.find((arg) => !arg.startsWith('-') && !arg.includes('='));
    await (verb === undefined ? undefined : held.get(verb));
    const ceiling = { ...env, GIT_CEILING_DIRECTORIES: dirname(root) };
    const excludes = join(root, '.git', 'atlas-sync', 'exclude');
    return gitIn(root, ['-c', `core.excludesFile=${excludes}`, ...args], ceiling);
  }

  async function syncFile(root: string, name: string, contents?: string | null) {
    if (!SYNC_FILES.has(name)) throw new Error(`"${name}" is not a sync file`);
    const path = join(root, '.git', 'atlas-sync', name);
    if (contents === undefined) return readFile(path, 'utf8').catch(() => null);
    if (contents === null) return rm(path, { force: true }).then(() => null);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, contents);
    await rename(`${path}.tmp`, path);
    return null;
  }

  return {
    env,
    /** The bare repository `gh repo create <name>` made. */
    remote: (name: string) => join(remotes, `${name}.git`),
    /** A bare repository on "GitHub" on `branch`, empty, for another Mac to fill. */
    async bareRepository(name: string, branch = 'main') {
      const bare = join(remotes, `${name}.git`);
      await gitIn(remotes, ['init', '--quiet', '--bare', `--initial-branch=${branch}`, bare], env);
      return bare;
    },
    /** What `gh repo list` answers with from here on. */
    setRepositories(next: ListedRepository[]) {
      repositories = next;
    },
    /** Holds every run of git with this verb until the returned function is called. */
    hold(verb: string): () => void {
      let release: () => void = () => {};
      held.set(verb, new Promise<void>((resolve) => (release = resolve)));
      return () => {
        held.delete(verb);
        release();
      };
    },
    setMacName(name: string) {
      macName = name;
    },
    async answer(command: string, args: unknown, openRoot: () => string): Promise<unknown> {
      const named = args as { args: string[]; name: string; contents?: string | null };
      switch (command) {
        case 'this_mac_name':
          return macName;
        case 'git_run':
          return inVault(openRoot(), named.args);
        case 'git_run_in': {
          const { folder, args: argv } = args as { folder: string; args: string[] };
          return gitIn(folder, argv, env);
        }
        case 'gh_repo_create':
          return repoCreate(openRoot(), named.name);
        case 'gh_repo_list':
          return { code: 0, stdout: JSON.stringify(repositories), stderr: '' } satisfies GitOutput;
        case 'git_sync_file_read':
          return syncFile(openRoot(), named.name);
        case 'git_sync_file_write':
          return syncFile(openRoot(), named.name, named.contents ?? null);
        default:
          return undefined;
      }
    },
  };
}

export type GitStub = Awaited<ReturnType<typeof createGitStub>>;

/** Another Mac: a clone of the vault's repository, edited and pushed from the test. */
export async function otherMac(stub: GitStub, remote: string, name: string) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'atlas-e2e-other-mac-')));
  const root = join(parent, 'vault');
  const cloned = await gitIn(parent, ['clone', '--quiet', remote, root], stub.env);
  if (cloned.code !== 0) throw new Error(`the other Mac could not clone: ${cloned.stderr}`);
  const git = (...args: string[]) => gitIn(root, args, stub.env);
  return {
    root,
    git,
    async commitAndPush(message: string) {
      await git('add', '--all');
      const committed = await git(
        '-c',
        `user.name=Atlas on ${name}`,
        '-c',
        'user.email=other@mac.local',
        'commit',
        '--quiet',
        '-m',
        message,
      );
      if (committed.code !== 0)
        throw new Error(`the other Mac could not commit: ${committed.stderr}`);
      const pushed = await git('push', '--quiet', 'origin', 'HEAD');
      if (pushed.code !== 0) throw new Error(`the other Mac could not push: ${pushed.stderr}`);
    },
    async pull() {
      const branch = (await git('symbolic-ref', '--short', 'HEAD')).stdout.trim() || 'main';
      const pulled = await git(
        '-c',
        `user.name=Atlas on ${name}`,
        '-c',
        'user.email=other@mac.local',
        'pull',
        '--quiet',
        '--no-rebase',
        'origin',
        branch,
      );
      if (pulled.code !== 0) throw new Error(`the other Mac could not pull: ${pulled.stderr}`);
    },
  };
}
