/**
 * What to tell the person when git or gh fails (U-29): the few failures a
 * sync meets in practice, in words that say what to do, and otherwise the
 * last thing the program said.
 */

/** The step name a repository is created under: only its failures mean a name is taken. */
export const CREATE_REPOSITORY_STEP = 'create the GitHub repository';

const EXPLAINED: readonly {
  readonly test: RegExp;
  readonly say: string;
  readonly step?: string;
}[] = [
  {
    test: /could not read Username|Authentication failed|terminal prompts disabled|Permission denied \(publickey/i,
    say: 'GitHub didn’t accept this Mac’s login. In Terminal, run `gh auth login`, then `gh auth setup-git`, and sync again.',
  },
  {
    test: /gh auth login|not logged in|authentication token/i,
    say: 'The GitHub command line isn’t logged in. In Terminal, run `gh auth login`, then try again.',
  },
  {
    test: /Repository not found|does not appear to be a git repository/i,
    say: 'GitHub can’t find that repository, or this Mac’s login can’t see it. Check the address and that you’re logged in as its owner.',
  },
  {
    test: /Permission to .* denied|returned error: 403/i,
    say: 'GitHub refused: the account this Mac is logged in as can’t write to that repository. Log in as its owner with `gh auth login`, or ask to be added to it.',
  },
  {
    // gh adds `origin` after making the repository: a vault that already has
    // one fails there, with the name free (issue #8). Not a name to change.
    test: /remote origin already exists/i,
    say: 'This vault already sends to a repository of its own (its origin), so the new one couldn’t be connected to it. Use Connect existing repo with that repository’s address, or remove the vault’s origin first.',
    step: CREATE_REPOSITORY_STEP,
  },
  {
    // gh's own words for a name in use; git says "already exists" of files and remotes too.
    test: /Name already exists on this account/i,
    say: 'You already have a repository with that name on GitHub. Pick another name, or connect that one by its address.',
    step: CREATE_REPOSITORY_STEP,
  },
  {
    test: /exceeds GitHub's file size limit|GH001: Large files detected/i,
    say: 'GitHub refused a file over its 100 MB size limit. Atlas keeps such files out of sync; make the file smaller or move it out of the vault, then sync again.',
  },
  {
    test: /Could not resolve host|Network is unreachable|Connection timed out|Operation timed out|unable to access/i,
    say: 'GitHub couldn’t be reached. Atlas will try again on the next sync.',
  },
  {
    test: /ran longer than/i,
    say: 'Git took too long and was stopped. Atlas will try again on the next sync.',
  },
];

/** The last few meaningful lines of what a program printed, on one line. */
function lastWords(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.replace(/^(fatal|error|hint): /, '').trim())
    .filter((line) => line !== '');
  return lines.slice(-2).join(' ');
}

export function explainGitFailure({ step, stderr }: { step: string; stderr: string }): string {
  const known = EXPLAINED.find(
    (explained) =>
      (explained.step === undefined || explained.step === step) && explained.test.test(stderr),
  );
  if (known !== undefined) return known.say;
  const said = lastWords(stderr);
  return said === '' ? `Git could not ${step}.` : `Git could not ${step}: ${said}`;
}

/** What to say when the program itself is not on this Mac. */
export function missingProgramMessage(program: 'git' | 'gh'): string {
  return program === 'git'
    ? 'Git isn’t installed on this Mac. In Terminal, run `xcode-select --install` (or `brew install git`), then try again.'
    : 'The GitHub command line isn’t installed. In Terminal, run `brew install gh` and `gh auth login`, or connect a repository you made on github.com by its address.';
}
