//! The host's side of running git for sync: which shapes it runs, what a child
//! is handed, and a real `git` round trip through a bare remote in temp folders.

use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use super::shapes::{clone_name, is_url, vet_folder_args, vet_repo_name, vet_vault_args, Reach};
use super::{
    Confirm, GitHost, GitOutput, Limits, DECLINED, FIXED_PREFIX, GH_DIRS, GIT_DIRS, NOT_CHOSEN,
    NOT_FOUND,
};
use std::sync::{Arc, Mutex};

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|arg| arg.to_string()).collect()
}

fn vault_ok(list: &[&str]) -> bool {
    vet_vault_args(&args(list)).is_ok()
}

fn folder_ok(list: &[&str]) -> bool {
    vet_folder_args(&args(list)).is_ok()
}

/// Every shape the TypeScript side builds, as it builds them.
const ACCEPTED: &[&[&str]] = &[
    &["rev-parse", "--show-toplevel"],
    &["init", "--quiet", "--initial-branch=main"],
    &[
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
    ],
    &["add", "--all"],
    &[
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        "Atlas sync from James's Mac 2026-09-28 10:00",
    ],
    &[
        "-c",
        "user.name=Atlas on Work Mac",
        "-c",
        "user.email=atlas@work-mac.local",
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        "Atlas sync",
    ],
    &["fetch", "--quiet", "origin"],
    &[
        "merge",
        "--no-edit",
        "--allow-unrelated-histories",
        "origin/main",
    ],
    &["push", "--quiet", "--set-upstream", "origin", "HEAD"],
    &["remote", "get-url", "origin"],
    &[
        "remote",
        "add",
        "origin",
        "https://github.com/james/vault.git",
    ],
    &[
        "remote",
        "set-url",
        "origin",
        "git@github.com:james/vault.git",
    ],
    &["symbolic-ref", "--quiet", "--short", "HEAD"],
    &["log", "-1", "--format=%H%x00%ct"],
    &["log", "-1", "--format=%s", "origin/main", "--"],
    &["checkout", "--ours", "--", "Notes/Ideas.md"],
    &["checkout", "--theirs", "--", "Attachments/photo 1.png"],
    &["config", "--get", "user.name"],
    &["config", "--get", "user.email"],
    &["rev-parse", "--verify", "--quiet", "origin/feature/x"],
    &["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
    &[
        "-c",
        "core.ignoreCase=false",
        "ls-files",
        "-z",
        "--others",
        "--exclude-standard",
    ],
    &["ls-files", "-z", "--stage"],
    &["mv", "--", "idea.md", "idea (conflict from Laptop).md"],
    &["ls-tree", "-r", "-z", "HEAD"],
    &["ls-tree", "-r", "-z", "origin/main"],
    &[
        "ls-tree",
        "-r",
        "-z",
        "0123456789abcdef0123456789abcdef01234567",
    ],
    &["merge-base", "HEAD", "origin/main"],
    &["hash-object", "--no-filters", "--", "Notes/Idea.md"],
    &[
        "update-index",
        "--add",
        "--cacheinfo",
        "100644,0123456789abcdef0123456789abcdef01234567,Idea (conflict from Studio).md",
    ],
    &["checkout-index", "--", "Idea (conflict from Studio).md"],
    &["rm", "--cached", "--quiet", "--", "Attachments/talk.mov"],
    &["reset", "--quiet", "--", "Data/dump.bin"],
    &["reset", "--quiet", "--soft", "origin/main"],
    &[
        "rev-list",
        "--objects",
        "--filter=blob:limit=99614720",
        "--filter-print-omitted",
        "HEAD",
        "--not",
        "--remotes=origin",
    ],
    &["ls-remote", "--symref", "origin", "HEAD"],
    &["branch", "-m", "master"],
];

#[test]
fn every_shape_atlas_runs_in_the_vault_is_accepted() {
    for shape in ACCEPTED {
        assert!(vault_ok(shape), "{shape:?} should be accepted");
    }
}

#[test]
fn only_fetch_push_and_ls_remote_reach_the_network_in_the_vault() {
    for shape in ACCEPTED {
        let reach = vet_vault_args(&args(shape)).unwrap();
        let network = ["fetch", "push", "ls-remote"]
            .iter()
            .any(|verb| shape.contains(verb));
        assert_eq!(reach == Reach::Network, network, "{shape:?}");
    }
}

#[test]
fn a_shape_missing_or_gaining_an_argument_is_refused() {
    for shape in ACCEPTED {
        for cut in 0..shape.len() {
            assert!(!vault_ok(&shape[..cut]), "{:?} is short", &shape[..cut]);
        }
        let mut longer = shape.to_vec();
        longer.push("--upload-pack=touch /tmp/pwned");
        assert!(!vault_ok(&longer), "{longer:?} is long");
    }
}

#[test]
fn every_argument_of_a_shape_refuses_what_it_may_not_hold() {
    // Nothing takes an empty argument: no fixed word is empty, and every value
    // slot refuses one. An option refuses everywhere but after `--`, where a
    // path may begin with a dash and git reads it as a path.
    for shape in ACCEPTED {
        for at in 0..shape.len() {
            let mut changed = shape.to_vec();
            changed[at] = "";
            assert!(!vault_ok(&changed), "{changed:?}");
            if shape[..at].contains(&"--") {
                continue;
            }
            changed[at] = "--exec=sh";
            assert!(!vault_ok(&changed), "{changed:?}");
        }
    }
}

#[test]
fn options_that_run_programs_are_refused_everywhere() {
    for attack in [
        &["fetch", "--upload-pack=sh -c x", "origin"][..],
        &["-c", "core.sshCommand=sh", "fetch", "--quiet", "origin"],
        &["-c", "core.pager=sh", "log", "-1", "--format=%H%x00%ct"],
        &["push", "--quiet", "--receive-pack=sh", "origin", "HEAD"],
        &[
            "clone", "--quiet", "--origin", "origin", "--", "/tmp/x", "y",
        ],
        &["config", "--global", "user.name", "x"],
        &["config", "--get", "core.sshCommand"],
        &["diff", "--output=/tmp/owned"],
        &["log", "-1", "--output=/tmp/owned"],
        &["submodule", "update"],
        &["rebase", "origin/main"],
        &["reset", "--hard", "origin/main"],
    ] {
        assert!(!vault_ok(attack), "{attack:?}");
    }
}

#[test]
fn a_commit_message_is_never_an_option_or_empty_or_endless() {
    let commit = |message: &str| vault_ok(&["commit", "--quiet", "--no-verify", "-m", message]);
    assert!(commit("Atlas sync"));
    assert!(commit("line one\nline two"));
    assert!(!commit(""));
    assert!(!commit("--amend"));
    assert!(!commit("a\0b"));
    assert!(commit(&"x".repeat(1000)));
    assert!(!commit(&"x".repeat(1001)));
}

#[test]
fn an_author_is_only_a_name_and_an_email_without_line_breaks() {
    let with = |name: &str, email: &str| {
        vault_ok(&[
            "-c",
            name,
            "-c",
            email,
            "commit",
            "--quiet",
            "--no-verify",
            "-m",
            "m",
        ])
    };
    assert!(with("user.name=A", "user.email=a@b"));
    assert!(!with("user.name=", "user.email=a@b"));
    assert!(!with("user.name=A", "user.email="));
    assert!(!with("user.name=A\n[core]", "user.email=a@b"));
    assert!(!with("user.email=a@b", "user.name=A"));
    assert!(!with("core.sshCommand=sh", "user.email=a@b"));
    assert!(!with("user.name=A", "core.hooksPath=/tmp"));
}

#[test]
fn a_merge_only_takes_a_branch_of_origin() {
    let merge = |reference: &str| {
        vault_ok(&[
            "merge",
            "--no-edit",
            "--allow-unrelated-histories",
            reference,
        ])
    };
    assert!(merge("origin/main"));
    assert!(merge("origin/release-1.2_x"));
    for refused in [
        "main",
        "origin/",
        "origin/-x",
        "origin//x",
        "origin/a..b",
        "origin/x/",
        "origin/../x",
        "upstream/main",
        "--strategy=ours",
        "origin/a b",
        &format!("origin/{}", "b".repeat(201)),
    ] {
        assert!(!merge(refused), "{refused:?}");
    }
}

#[test]
fn a_checkout_path_stays_inside_the_vault_and_out_of_git() {
    let ours = |path: &str| vault_ok(&["checkout", "--ours", "--", path]);
    assert!(ours("Note.md"));
    assert!(ours("Notes/Deep/Idea (conflict from Work Mac).md"));
    assert!(ours(".atlas/settings.md"));
    assert!(ours(".gitignore"));
    for refused in [
        "",
        "/etc/passwd",
        "../outside.md",
        "Notes/../../x",
        "./Note.md",
        "Notes//x.md",
        "Notes/",
        ".git/config",
        "Sub/.GIT/hooks/pre-commit",
        "a\0b",
    ] {
        assert!(!ours(refused), "{refused:?}");
    }
}

#[test]
fn a_remote_is_a_plain_address_never_a_command() {
    for accepted in [
        "https://github.com/james/vault.git",
        "ssh://git@github.com/james/vault.git",
        "git@github.com:james/vault.git",
        "/Volumes/Shared/vault.git",
    ] {
        assert!(is_url(accepted), "{accepted:?}");
    }
    for refused in [
        "",
        "ext::sh -c touch% /tmp/pwned",
        "ext::sh",
        "fd::17",
        "-uhttps://x",
        "--upload-pack=sh",
        "file:///tmp/x",
        "http://github.com/x",
        "relative/path",
        "https://github.com/a b",
        "https://github.com/a\nb",
        "git@github.com:-oProxyCommand=sh",
        "git@:x",
        "@github.com:x",
        "git@git hub.com:x",
        "git@github.com:",
        "transport::https://x",
        "git@github.com:ext::sh",
        &format!("https://{}", "a".repeat(2048)),
    ] {
        assert!(!is_url(refused), "{refused:?}");
        assert!(
            !vault_ok(&["remote", "add", "origin", refused]),
            "{refused:?}"
        );
    }
}

#[test]
fn only_asking_and_cloning_run_outside_the_vault() {
    assert!(folder_ok(&["rev-parse", "--show-toplevel"]));
    let clone = |url: &str, name: &str| {
        folder_ok(&["clone", "--quiet", "--origin", "origin", "--", url, name])
    };
    assert!(clone("git@github.com:james/vault.git", "vault"));
    assert!(!clone("ext::sh -c x", "vault"));
    for name in ["", ".hidden", "-x", "a/b", "..", "a\0b"] {
        assert!(!clone("/tmp/x.git", name), "{name:?}");
    }
    assert_eq!(
        clone_name(&args(&[
            "clone", "--quiet", "--origin", "origin", "--", "/r", "v"
        ])),
        Some("v")
    );
    assert_eq!(clone_name(&args(&["rev-parse", "--show-toplevel"])), None);
    // Nothing that changes a repository runs in a folder that is not the vault.
    for shape in ACCEPTED.iter().filter(|shape| shape[0] != "rev-parse") {
        assert!(!folder_ok(shape), "{shape:?}");
    }
    assert!(!folder_ok(&[
        "clone", "--quiet", "--origin", "origin", "/r", "v"
    ]));
    assert!(!folder_ok(&[
        "clone",
        "--quiet",
        "--origin",
        "origin",
        "--",
        "/r",
        "v",
        "--config=core.sshCommand=sh"
    ]));
}

#[test]
fn a_repository_name_is_githubs_characters_and_never_an_option() {
    for name in ["vault", "James-Vault_2.0", "a"] {
        assert_eq!(vet_repo_name(name), Ok(()), "{name}");
    }
    for name in [
        "",
        "-x",
        ".vault",
        "a b",
        "a/b",
        "--public",
        "vault;rm",
        &"a".repeat(101),
    ] {
        assert!(vet_repo_name(name).is_err(), "{name:?}");
    }
}

#[test]
fn the_fixed_prefix_turns_off_hooks_fsmonitor_and_ext() {
    let prefix = FIXED_PREFIX.join(" ");
    assert!(prefix.contains("-c core.hooksPath=/dev/null"));
    assert!(prefix.contains("-c core.fsmonitor=false"));
    assert!(prefix.contains("-c protocol.ext.allow=never"));
    assert!(prefix.contains("--literal-pathspecs"));
}

#[test]
fn the_programs_are_looked_for_only_in_absolute_folders() {
    for dir in GIT_DIRS.iter().chain(GH_DIRS) {
        assert!(Path::new(dir).is_absolute(), "{dir}");
    }
}

// --- Running a program ---------------------------------------------------

/// A fake program: a shell script with this name, in a folder of its own.
fn fake(name: &str, script: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    dir
}

const NO_LIMIT: Limits = Limits {
    local: Duration::from_secs(3600),
    network: Duration::from_secs(3600),
};

/// The host, looking for its programs in these folders (the test hook: the
/// webview has no say in where they are looked for).
fn host_in(dirs: &[&Path], home: Option<PathBuf>, limits: Limits) -> GitHost {
    let dirs: Vec<String> = std::iter::once("/nonexistent".to_string())
        .chain(dirs.iter().map(|dir| dir.display().to_string()))
        .collect();
    GitHost {
        git_dirs: dirs.clone(),
        gh_dirs: dirs,
        home,
        limits,
        grants: Arc::default(),
        confirm: Arc::new(Answers::always(true)),
    }
}

/// The person, as a test plays them: says yes or no, and remembers each question.
struct Answers {
    yes: bool,
    asked: Mutex<Vec<String>>,
}

impl Answers {
    fn always(yes: bool) -> Self {
        Self {
            yes,
            asked: Mutex::default(),
        }
    }
}

impl Confirm for Answers {
    fn ask(&self, question: &str, _yes: &str) -> bool {
        self.asked.lock().unwrap().push(question.to_string());
        self.yes
    }
}

/// The host, with the person answering through `answers`.
fn answering(host: GitHost, answers: Arc<Answers>) -> GitHost {
    GitHost {
        confirm: answers,
        ..host
    }
}

#[test]
fn the_child_gets_only_the_environment_it_needs() {
    assert!(std::env::var_os("CARGO_MANIFEST_DIR").is_some());
    let bin = fake("git", "exec /usr/bin/env");
    let home = tempfile::tempdir().unwrap();
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], Some(home.path().to_path_buf()), NO_LIMIT);
    let output = host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap();
    assert_eq!(output.code, Some(0));
    let vars: Vec<(String, String)> = output
        .stdout
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
    let names: HashSet<&str> = vars.iter().map(|(name, _)| name.as_str()).collect();
    // What sh itself sets on the way to `env`.
    let shell = ["PWD", "SHLVL", "_", "OLDPWD"];
    let allowed: HashSet<&str> = [
        "PATH",
        "HOME",
        "SSH_AUTH_SOCK",
        "LANG",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "GIT_TERMINAL_PROMPT",
        "GCM_INTERACTIVE",
        "GH_PROMPT_DISABLED",
        "GH_NO_UPDATE_NOTIFIER",
        "GIT_CEILING_DIRECTORIES",
    ]
    .into_iter()
    .chain(shell)
    .collect();
    assert!(names.is_subset(&allowed), "unexpected: {names:?}");
    let value = |name: &str| {
        vars.iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    assert_eq!(value("GIT_TERMINAL_PROMPT").as_deref(), Some("0"));
    assert_eq!(value("GH_PROMPT_DISABLED").as_deref(), Some("1"));
    assert_eq!(value("HOME"), Some(home.path().display().to_string()));
    assert_eq!(
        value("PATH"),
        Some(format!(
            "/nonexistent:{}:/usr/bin:/bin:/usr/sbin:/sbin",
            bin.path().display()
        ))
    );
    assert_eq!(value("CARGO_MANIFEST_DIR"), None);
}

#[test]
fn git_gets_the_fixed_prefix_then_the_vetted_arguments_in_the_vault() {
    let bin = fake("git", "pwd -P\nfor arg in \"$@\"; do echo \"$arg\"; done");
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let output = host
        .git_in_vault(vault.path(), &args(&["fetch", "--quiet", "origin"]))
        .unwrap();
    let mut lines = output.stdout.lines();
    assert_eq!(
        lines.next().map(PathBuf::from),
        Some(vault.path().canonicalize().unwrap())
    );
    let rest: Vec<&str> = lines.collect();
    let excludes = format!(
        "core.excludesFile={}",
        vault
            .path()
            .canonicalize()
            .unwrap()
            .join(".git/atlas-sync/exclude")
            .display()
    );
    let mut expected: Vec<&str> = FIXED_PREFIX.to_vec();
    expected.extend(["-c", excludes.as_str(), "fetch", "--quiet", "origin"]);
    assert_eq!(rest, expected);
}

#[test]
fn refused_arguments_run_nothing() {
    let marker = tempfile::tempdir().unwrap();
    let ran = marker.path().join("ran");
    let bin = fake("git", &format!("touch '{}'", ran.display()));
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let refused = host.git_in_vault(vault.path(), &args(&["reset", "--hard"]));
    assert!(refused
        .unwrap_err()
        .contains("not ones Atlas runs git with"));
    host.grant(vault.path()).unwrap();
    let refused = host.git_in_folder(vault.path(), &args(&["add", "--all"]), None);
    assert!(refused.is_err());
    assert!(host.create_repo(vault.path(), "--public").is_err());
    assert!(!ran.exists());
}

#[test]
fn no_program_is_reported_as_not_found() {
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[], None, NO_LIMIT);
    let error = host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap_err();
    assert!(error.starts_with(NOT_FOUND), "{error}");
    let error = host.create_repo(vault.path(), "vault").unwrap_err();
    assert!(error.starts_with(NOT_FOUND), "{error}");
}

#[test]
fn a_file_with_the_name_that_cannot_run_is_not_run() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("git"), "#!/bin/sh\necho ran\n").unwrap();
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[dir.path()], None, NO_LIMIT);
    let error = host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap_err();
    assert!(error.starts_with(NOT_FOUND));
}

#[test]
fn a_run_past_its_limit_is_stopped_and_says_why() {
    let bin = fake("git", "echo started\nexec sleep 30");
    let vault = tempfile::tempdir().unwrap();
    let limits = Limits {
        // Long enough that `echo` has run even when the machine is busy.
        local: Duration::from_secs(2),
        network: Duration::from_secs(3600),
    };
    let host = host_in(&[bin.path()], None, limits);
    let output = host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap();
    assert_eq!(output.code, None);
    assert_eq!(output.stdout, "started\n");
    assert!(
        output
            .stderr
            .ends_with("Atlas stopped git: it ran longer than 2s."),
        "{}",
        output.stderr
    );
}

#[test]
fn a_network_run_is_held_to_the_network_limit_not_the_local_one() {
    let bin = fake("git", "sleep 0.5\necho done");
    let vault = tempfile::tempdir().unwrap();
    let limits = Limits {
        local: Duration::from_millis(100),
        network: Duration::from_secs(3600),
    };
    let host = host_in(&[bin.path()], None, limits);
    let output = host
        .git_in_vault(vault.path(), &args(&["fetch", "--quiet", "origin"]))
        .unwrap();
    assert_eq!(output.code, Some(0));
    assert_eq!(output.stdout, "done\n");
}

#[test]
fn a_failing_run_reports_its_code_and_the_end_of_stderr() {
    let bin = fake(
        "git",
        "head -c 20000 /dev/zero | tr '\\0' 'e' >&2\necho LAST >&2\nexit 3",
    );
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let output = host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap();
    assert_eq!(output.code, Some(3));
    assert_eq!(output.stderr.len(), 8 * 1024);
    assert!(output.stderr.ends_with("LAST\n"));
}

#[test]
fn a_clone_never_lands_on_something_already_there() {
    let bin = fake("git", "echo ran");
    let parent = tempfile::tempdir().unwrap();
    fs::create_dir(parent.path().join("vault")).unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    host.grant(parent.path()).unwrap();
    let clone = |name: &str| host.git_in_folder(parent.path(), &clone_args(name), None);
    assert!(clone("vault")
        .unwrap_err()
        .contains("already in that folder"));
    assert_eq!(clone("fresh").unwrap().stdout, "ran\n");
    assert!(host
        .git_in_folder(
            Path::new("relative"),
            &args(&["rev-parse", "--show-toplevel"]),
            None,
        )
        .is_err());
    assert!(host
        .git_in_folder(
            &parent.path().join("missing"),
            &args(&["rev-parse", "--show-toplevel"]),
            None,
        )
        .is_err());
}

fn clone_args(name: &str) -> Vec<String> {
    args(&[
        "clone", "--quiet", "--origin", "origin", "--", "/r.git", name,
    ])
}

#[test]
fn a_clone_goes_only_into_a_folder_the_person_picked() {
    let marker = tempfile::tempdir().unwrap();
    let ran = marker.path().join("ran");
    let bin = fake("git", &format!("touch '{}'", ran.display()));
    let picked = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    host.grant(picked.path()).unwrap();
    let error = host
        .git_in_folder(elsewhere.path(), &clone_args("vault"), None)
        .unwrap_err();
    assert_eq!(error, NOT_CHOSEN);
    assert!(!ran.exists());
    // The picked folder named another way — through a link — is still that folder.
    let link = marker.path().join("link");
    std::os::unix::fs::symlink(picked.path(), &link).unwrap();
    host.git_in_folder(&link, &clone_args("vault"), None)
        .unwrap();
    assert!(ran.exists());
}

#[test]
fn asking_where_a_folder_sits_is_allowed_only_above_the_open_vault_or_in_a_picked_folder() {
    let bin = fake("git", "echo asked");
    let parent = tempfile::tempdir().unwrap();
    let vault = parent.path().join("vault");
    fs::create_dir(&vault).unwrap();
    let other = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let ask = |folder: &Path, open: Option<&Path>| {
        host.git_in_folder(folder, &args(&["rev-parse", "--show-toplevel"]), open)
    };
    assert_eq!(ask(parent.path(), Some(&vault)).unwrap().stdout, "asked\n");
    assert_eq!(ask(other.path(), Some(&vault)).unwrap_err(), NOT_CHOSEN);
    assert_eq!(ask(parent.path(), None).unwrap_err(), NOT_CHOSEN);
    // The folder above the vault is for asking only, never for a clone.
    assert_eq!(
        host.git_in_folder(parent.path(), &clone_args("x"), Some(&vault))
            .unwrap_err(),
        NOT_CHOSEN
    );
    host.grant(other.path()).unwrap();
    assert_eq!(ask(other.path(), None).unwrap().stdout, "asked\n");
}

#[test]
fn the_person_is_asked_before_a_remote_a_clone_or_a_repository_and_no_runs_nothing() {
    let marker = tempfile::tempdir().unwrap();
    let ran = marker.path().join("ran");
    let bin = fake("git", &format!("touch '{}'", ran.display()));
    fs::copy(bin.path().join("git"), bin.path().join("gh")).unwrap();
    let vault = tempfile::tempdir().unwrap();
    let picked = tempfile::tempdir().unwrap();
    let no = Arc::new(Answers::always(false));
    let host = answering(host_in(&[bin.path()], None, NO_LIMIT), Arc::clone(&no));
    host.grant(picked.path()).unwrap();
    let url = "git@github.com:james/vault.git";
    for verb in ["add", "set-url"] {
        let error = host
            .git_in_vault(vault.path(), &args(&["remote", verb, "origin", url]))
            .unwrap_err();
        assert_eq!(
            error,
            format!("{DECLINED} You cancelled connecting the vault to {url}.")
        );
    }
    let error = host
        .git_in_folder(picked.path(), &clone_args("vault"), None)
        .unwrap_err();
    assert!(error.starts_with(DECLINED), "{error}");
    let error = host.create_repo(vault.path(), "notes").unwrap_err();
    assert!(error.starts_with(DECLINED), "{error}");
    assert!(!ran.exists(), "something ran without a yes");
    assert_eq!(
        no.asked.lock().unwrap().as_slice(),
        [
            format!("Connect this vault to {url}?"),
            format!("Connect this vault to {url}?"),
            "Copy the vault at /r.git to this Mac, into vault?".to_string(),
            "Create the private GitHub repository notes and upload this vault to it?".to_string(),
        ]
    );

    // A yes lets each one run; nothing else is asked about.
    let yes = Arc::new(Answers::always(true));
    let host = answering(host, Arc::clone(&yes));
    host.git_in_vault(vault.path(), &args(&["remote", "add", "origin", url]))
        .unwrap();
    assert!(ran.exists());
    host.git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap();
    assert_eq!(yes.asked.lock().unwrap().len(), 1);
}

#[test]
fn the_default_host_says_no_to_everything_it_would_have_to_ask() {
    let host = GitHost::default();
    let vault = tempfile::tempdir().unwrap();
    let error = host.create_repo(vault.path(), "notes").unwrap_err();
    assert!(error.starts_with(DECLINED), "{error}");
}

#[test]
fn a_local_run_is_given_ten_minutes() {
    assert_eq!(GitHost::default().limits.local, Duration::from_secs(600));
}

#[test]
fn a_stopped_run_leaves_no_index_lock_behind() {
    let bin = fake(
        "git",
        "mkdir -p .git && touch .git/index.lock && echo locked\nexec sleep 30",
    );
    let vault = tempfile::tempdir().unwrap();
    let limits = Limits {
        local: Duration::from_secs(2),
        network: Duration::from_secs(3600),
    };
    let host = host_in(&[bin.path()], None, limits);
    let output = host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap();
    assert_eq!(output.stdout, "locked\n");
    assert_eq!(output.code, None);
    assert!(!vault.path().join(".git/index.lock").exists());
}

#[test]
fn a_run_that_ends_by_itself_leaves_git_s_own_lock_alone() {
    let bin = fake("git", "mkdir -p .git && touch .git/index.lock");
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    ok(host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap());
    assert!(vault.path().join(".git/index.lock").exists());
}

#[test]
fn git_never_looks_above_the_vault_for_a_repository() {
    let bin = fake("git", "echo \"$GIT_CEILING_DIRECTORIES\"");
    let parent = tempfile::tempdir().unwrap();
    let vault = parent.path().join("vault");
    fs::create_dir(&vault).unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let output = host.git_in_vault(&vault, &args(&["add", "--all"])).unwrap();
    assert_eq!(
        output.stdout.trim(),
        parent.path().canonicalize().unwrap().display().to_string()
    );
}

#[test]
fn a_vault_inside_another_repository_is_not_taken_for_part_of_it() {
    let Some(git_dir) = real_git_dir() else {
        println!("skipped: no git in {GIT_DIRS:?}");
        return;
    };
    let work = tempfile::tempdir().unwrap();
    let home = work.path().join("home");
    fs::create_dir(&home).unwrap();
    let host = host_in(&[&git_dir], Some(home), NO_LIMIT);
    let outer = work.path().join("code");
    let vault = outer.join("vault");
    fs::create_dir_all(&vault).unwrap();
    let made = Command::new(git_dir.join("git"))
        .args(["init", "--quiet", "--initial-branch=main"])
        .arg(&outer)
        .status()
        .unwrap();
    assert!(made.success());
    fs::write(vault.join("Note.md"), "private\n").unwrap();

    let top = host
        .git_in_vault(&vault, &args(&["rev-parse", "--show-toplevel"]))
        .unwrap();
    assert_ne!(top.code, Some(0), "{top:?}");
    let added = host.git_in_vault(&vault, &args(&["add", "--all"])).unwrap();
    assert_ne!(added.code, Some(0), "{added:?}");
    assert!(
        !outer.join(".git/index").exists(),
        "the outer repository was staged into"
    );
}

#[test]
fn a_half_done_merge_can_be_asked_about() {
    assert!(vault_ok(&[
        "rev-parse",
        "--verify",
        "--quiet",
        "MERGE_HEAD"
    ]));
    assert!(!vault_ok(&[
        "rev-parse",
        "--verify",
        "--quiet",
        "ORIG_HEAD"
    ]));
}

#[test]
fn gh_is_run_with_the_one_create_shape() {
    let bin = fake("gh", "for arg in \"$@\"; do echo \"$arg\"; done");
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let output = host.create_repo(vault.path(), "my-vault").unwrap();
    assert_eq!(
        output.stdout.lines().collect::<Vec<_>>(),
        [
            "repo",
            "create",
            "my-vault",
            "--private",
            "--source=.",
            "--remote=origin",
            "--push"
        ]
    );
}

#[test]
fn the_mac_has_a_name() {
    assert!(!super::mac_name().trim().is_empty());
}

// --- A real git round trip ------------------------------------------------

/// The system git's folder, when there is one.
fn real_git_dir() -> Option<PathBuf> {
    GIT_DIRS
        .iter()
        .map(PathBuf::from)
        .find(|dir| dir.join("git").is_file())
}

fn ok(output: GitOutput) -> GitOutput {
    assert_eq!(output.code, Some(0), "{output:?}");
    output
}

fn commit(host: &GitHost, repo: &Path, message: &str) {
    ok(host.git_in_vault(repo, &args(&["add", "--all"])).unwrap());
    ok(host
        .git_in_vault(
            repo,
            &args(&[
                "-c",
                "user.name=Atlas Test",
                "-c",
                "user.email=atlas@test.local",
                "commit",
                "--quiet",
                "--no-verify",
                "-m",
                message,
            ]),
        )
        .unwrap());
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.file_name().is_some_and(|name| name == ".git") {
            continue;
        }
        if path.is_dir() {
            found.extend(files_under(&path));
        } else {
            found.push(path);
        }
    }
    found
}

/// Two Macs change one note differently and another note on one side; the
/// merge conflicts, and the conflict is resolved with the host's own shapes:
/// this Mac's version in place, the other's saved beside it, no markers.
#[test]
fn a_conflict_round_trip_keeps_both_versions_and_leaves_no_markers() {
    let Some(git_dir) = real_git_dir() else {
        println!("skipped: no git in {GIT_DIRS:?}");
        return;
    };
    let work = tempfile::tempdir().unwrap();
    // A home of its own, so the person's global git config plays no part.
    let home = work.path().join("home");
    fs::create_dir(&home).unwrap();
    let host = host_in(&[&git_dir], Some(home), NO_LIMIT);
    let a = work.path().join("A");
    let macs = work.path().join("macs");
    let bare = work.path().join("remote.git");
    fs::create_dir(&a).unwrap();
    fs::create_dir(&macs).unwrap();
    let made = Command::new(git_dir.join("git"))
        .args(["init", "--quiet", "--bare", "--initial-branch=main"])
        .arg(&bare)
        .status()
        .unwrap();
    assert!(made.success());

    // Mac A sets up sync.
    ok(host
        .git_in_vault(&a, &args(&["init", "--quiet", "--initial-branch=main"]))
        .unwrap());
    fs::write(a.join("Note.md"), "# Note\n\nbase\n").unwrap();
    fs::write(a.join("Other.md"), "other\n").unwrap();
    commit(&host, &a, "Atlas sync set up");
    let remote = bare.display().to_string();
    ok(host
        .git_in_vault(&a, &args(&["remote", "add", "origin", &remote]))
        .unwrap());
    ok(host
        .git_in_vault(
            &a,
            &args(&["push", "--quiet", "--set-upstream", "origin", "HEAD"]),
        )
        .unwrap());

    // Mac B opens it from the remote, into a folder the person picked.
    host.grant(&macs).unwrap();
    ok(host
        .git_in_folder(
            &macs,
            &args(&["clone", "--quiet", "--origin", "origin", "--", &remote, "B"]),
            None,
        )
        .unwrap());
    let b = macs.join("B");
    let from_b = "# Note\n\nwritten on B\r\n\u{2014} with bytes \u{e9}\n";
    fs::write(b.join("Note.md"), from_b).unwrap();
    fs::write(b.join("Other.md"), "other, from B\n").unwrap();
    commit(&host, &b, "Atlas sync from B");
    ok(host
        .git_in_vault(
            &b,
            &args(&["push", "--quiet", "--set-upstream", "origin", "HEAD"]),
        )
        .unwrap());

    // Mac A changed the same note meanwhile, then syncs.
    let from_a = "# Note\n\nwritten on A\n";
    fs::write(a.join("Note.md"), from_a).unwrap();
    commit(&host, &a, "Atlas sync from A");
    ok(host
        .git_in_vault(&a, &args(&["fetch", "--quiet", "origin"]))
        .unwrap());
    let merged = host
        .git_in_vault(
            &a,
            &args(&[
                "merge",
                "--no-edit",
                "--allow-unrelated-histories",
                "origin/main",
            ]),
        )
        .unwrap();
    assert_ne!(merged.code, Some(0), "the edits conflict: {merged:?}");
    let status = ok(host
        .git_in_vault(
            &a,
            &args(&[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ]),
        )
        .unwrap());
    assert!(
        status
            .stdout
            .split('\0')
            .any(|entry| entry.starts_with("u UU ") && entry.ends_with(" Note.md")),
        "{:?}",
        status.stdout
    );

    // Resolve: theirs beside, ours in place, as the TypeScript side does.
    let copy = "Note (conflict from B).md";
    ok(host
        .git_in_vault(&a, &args(&["checkout", "--theirs", "--", "Note.md"]))
        .unwrap());
    fs::rename(a.join("Note.md"), a.join(copy)).unwrap();
    ok(host
        .git_in_vault(&a, &args(&["checkout", "--ours", "--", "Note.md"]))
        .unwrap());
    commit(&host, &a, "Atlas sync from A, keeping both");
    ok(host
        .git_in_vault(
            &a,
            &args(&["push", "--quiet", "--set-upstream", "origin", "HEAD"]),
        )
        .unwrap());

    assert_eq!(fs::read(a.join("Note.md")).unwrap(), from_a.as_bytes());
    assert_eq!(fs::read(a.join(copy)).unwrap(), from_b.as_bytes());
    assert_eq!(
        fs::read_to_string(a.join("Other.md")).unwrap(),
        "other, from B\n"
    );
    for file in files_under(&a) {
        let text = String::from_utf8_lossy(&fs::read(&file).unwrap()).into_owned();
        assert!(
            !text.contains("<<<<<<<") && !text.contains(">>>>>>>"),
            "{} holds conflict markers",
            file.display()
        );
    }
    let clean = ok(host
        .git_in_vault(
            &a,
            &args(&[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ]),
        )
        .unwrap());
    assert!(
        !clean
            .stdout
            .split('\0')
            .any(|entry| !entry.is_empty() && !entry.starts_with('#')),
        "{:?}",
        clean.stdout
    );

    // Mac B pulls the resolution: both versions arrive, still byte for byte.
    ok(host
        .git_in_vault(&b, &args(&["fetch", "--quiet", "origin"]))
        .unwrap());
    ok(host
        .git_in_vault(
            &b,
            &args(&[
                "merge",
                "--no-edit",
                "--allow-unrelated-histories",
                "origin/main",
            ]),
        )
        .unwrap());
    assert_eq!(fs::read(b.join("Note.md")).unwrap(), from_a.as_bytes());
    assert_eq!(fs::read(b.join(copy)).unwrap(), from_b.as_bytes());
}

/// A hook planted in the vault's `.git` never runs: the prefix points git's
/// hooks at nothing.
#[test]
fn a_hook_in_the_vault_never_runs() {
    let Some(git_dir) = real_git_dir() else {
        println!("skipped: no git in {GIT_DIRS:?}");
        return;
    };
    let work = tempfile::tempdir().unwrap();
    let home = work.path().join("home");
    fs::create_dir(&home).unwrap();
    let host = host_in(&[&git_dir], Some(home), NO_LIMIT);
    let vault = work.path().join("vault");
    fs::create_dir(&vault).unwrap();
    ok(host
        .git_in_vault(&vault, &args(&["init", "--quiet", "--initial-branch=main"]))
        .unwrap());
    let ran = work.path().join("hook-ran");
    let hook = vault.join(".git/hooks/pre-commit");
    fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\n", ran.display())).unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let post = vault.join(".git/hooks/post-commit");
    fs::copy(&hook, &post).unwrap();
    fs::write(vault.join("Note.md"), "x\n").unwrap();
    // `--no-verify` skips pre-commit; post-commit would still run without the prefix.
    commit(&host, &vault, "Atlas sync");
    assert!(!ran.exists(), "a hook ran");
}

// --- Adversarial (U-29 review) ----------------------------------------------

#[test]
fn adversarial_an_ssh_address_whose_host_starts_like_an_option_is_refused() {
    // CVE-2017-1000117's shape: the host slot of an ssh:// URL handed to ssh as
    // an option. Git itself refuses it today; the shape check says it refuses
    // anything that starts like an option, and this host does.
    let url = "ssh://-oProxyCommand=open${IFS}-a${IFS}Calculator/x";
    assert!(!is_url(url), "{url:?}");
    assert!(!vault_ok(&["remote", "add", "origin", url]));
}

#[test]
fn adversarial_odd_but_real_note_paths_reach_checkout() {
    let ours = |path: &str| vault_ok(&["checkout", "--ours", "--", path]);
    for accepted in [
        "My note -> draft.md",
        "Caf\u{e9}/na\u{ef}ve \u{65e5}\u{672c}.md",
        "two\nlines.md",
        "Ideas [draft] *?.md",
        ":(top)looks like magic.md",
        "..hidden dots.md",
        "Sync conflicts/atlas/settings (conflict from Work-Home Mac).md",
    ] {
        assert!(ours(accepted), "{accepted:?}");
    }
    for refused in [".Git", "a/.gIt/x", "a/../b", "a/./b", "a/"] {
        assert!(!ours(refused), "{refused:?}");
    }
}

#[test]
fn adversarial_a_clone_name_is_one_plain_new_folder() {
    let clone = |name: &str| {
        folder_ok(&[
            "clone", "--quiet", "--origin", "origin", "--", "/r.git", name,
        ])
    };
    assert!(clone("notes"));
    assert!(clone(&"n".repeat(255)));
    for refused in [
        "".to_string(),
        ".".to_string(),
        "..".to_string(),
        ".git".to_string(),
        "-x".to_string(),
        "a/b".to_string(),
        "a\0b".to_string(),
        "n".repeat(256),
    ] {
        assert!(!clone(&refused), "{refused:?}");
    }
}

#[test]
fn adversarial_a_merge_ref_never_escapes_origin() {
    let merge = |reference: &str| {
        vault_ok(&[
            "merge",
            "--no-edit",
            "--allow-unrelated-histories",
            reference,
        ])
    };
    assert!(merge("origin/main"));
    assert!(merge("origin/feature/x"));
    for refused in [
        "origin/",
        "origin/main..origin/x",
        "origin/-x",
        "origin/main@{1}",
        "origin/main^",
        "origin/main~1",
        "origin//main",
        "main",
        "upstream/main",
    ] {
        assert!(!merge(refused), "{refused:?}");
    }
}

/// `--literal-pathspecs` in the fixed prefix is what keeps a note named like
/// a glob from reaching other files: `checkout --ours -- "Idea [ab].md"` must
/// not also touch `Idea a.md`.
#[test]
fn adversarial_a_checkout_of_a_glob_like_name_touches_only_that_file() {
    let Some(git_dir) = real_git_dir() else {
        println!("skipped: no git in {GIT_DIRS:?}");
        return;
    };
    let work = tempfile::tempdir().unwrap();
    let home = work.path().join("home");
    fs::create_dir(&home).unwrap();
    let host = host_in(&[&git_dir], Some(home), NO_LIMIT);
    let repo = work.path().join("A");
    fs::create_dir(&repo).unwrap();
    ok(host
        .git_in_vault(&repo, &args(&["init", "--quiet", "--initial-branch=main"]))
        .unwrap());
    fs::write(repo.join("Idea [ab].md"), "committed glob\n").unwrap();
    fs::write(repo.join("Idea a.md"), "committed a\n").unwrap();
    commit(&host, &repo, "base");
    fs::write(repo.join("Idea [ab].md"), "edited glob\n").unwrap();
    fs::write(repo.join("Idea a.md"), "edited a\n").unwrap();
    ok(host
        .git_in_vault(&repo, &args(&["checkout", "--ours", "--", "Idea [ab].md"]))
        .unwrap());
    assert_eq!(
        fs::read_to_string(repo.join("Idea [ab].md")).unwrap(),
        "committed glob\n"
    );
    assert_eq!(
        fs::read_to_string(repo.join("Idea a.md")).unwrap(),
        "edited a\n",
        "a glob-like path reached another file"
    );
}

// --- A30: two Macs, one remote --------------------------------------------

/// A vault opened through a symlink (`~/Vault` -> `~/Documents/Vault`): the open
/// vault's root is kept as it was picked, so TypeScript asks about the folder
/// above the link (`parentFolderOf(vaultRoot)`), while the host allows only
/// the folder above the resolved vault. Every inspection then fails with "that
/// folder was not chosen in Atlas", and sync can never be set up, nor refused
/// for the right reason.
#[test]
fn adversarial_a_vault_opened_through_a_symlink_can_be_asked_where_it_sits() {
    let bin = fake("git", "echo asked");
    let work = tempfile::tempdir().unwrap();
    let real = work.path().join("Documents").join("Vault");
    fs::create_dir_all(&real).unwrap();
    let links = work.path().join("home");
    fs::create_dir(&links).unwrap();
    let link = links.join("Vault");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    // What `repositoryPlace` sends: the folder above the vault's root as it was opened.
    let asked = host.git_in_folder(
        link.parent().unwrap(),
        &args(&["rev-parse", "--show-toplevel"]),
        Some(&link),
    );
    assert_eq!(asked.map(|output| output.stdout), Ok("asked\n".to_string()));
}

/// Branch names git allows and people use (`notes+work`, `café`): the Ref slot
/// refuses them, so a vault on such a branch fails every sync at the first
/// `rev-parse --verify origin/<branch>`, with a message about arguments.
#[test]
fn adversarial_a_branch_git_allows_can_be_merged() {
    for branch in ["origin/notes+work", "origin/caf\u{e9}", "origin/james@home"] {
        assert!(
            vault_ok(&["rev-parse", "--verify", "--quiet", branch]),
            "{branch:?} is a branch git allows"
        );
    }
}

// --- A29-01: the review's host findings ------------------------------------

/// A Mac's own git settings would otherwise decide how a sync goes: a commit
/// that must be signed fails without the key, `merge.ff=only` refuses every
/// merge, `core.autocrlf` rewrites line endings, and a global excludes file
/// leaves attachments out. Every run in the vault turns each off.
#[test]
fn a_run_in_the_vault_turns_off_the_macs_own_git_settings() {
    let bin = fake("git", "for arg in \"$@\"; do echo \"$arg\"; done");
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let output = host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap();
    let lines: Vec<&str> = output.stdout.lines().collect();
    let settings: Vec<&str> = lines
        .windows(2)
        .filter(|pair| pair[0] == "-c")
        .map(|pair| pair[1])
        .collect();
    for setting in [
        "commit.gpgSign=false",
        "tag.gpgSign=false",
        "merge.ff=true",
        "core.autocrlf=false",
    ] {
        assert!(settings.contains(&setting), "{setting} in {settings:?}");
    }
    let excludes = vault
        .path()
        .canonicalize()
        .unwrap()
        .join(".git/atlas-sync/exclude");
    assert!(
        settings.contains(&format!("core.excludesFile={}", excludes.display()).as_str()),
        "the vault's own excludes file in {settings:?}"
    );
}

/// `gh repo create --push` runs git itself: the vault's hooks must not run
/// there either, nor the Mac's signing setting.
#[test]
fn gh_runs_git_with_the_vaults_hooks_off() {
    let bin = fake("gh", "env | grep '^GIT_CONFIG_' | sort");
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let output = host.create_repo(vault.path(), "my-vault").unwrap();
    let env: Vec<&str> = output.stdout.lines().collect();
    let value_of = |key: &str| {
        let slot = env
            .iter()
            .find(|line| line.starts_with("GIT_CONFIG_KEY_") && line.ends_with(&format!("={key}")))?
            .strip_prefix("GIT_CONFIG_KEY_")?
            .split('=')
            .next()?
            .to_string();
        env.iter()
            .find_map(|line| line.strip_prefix(&format!("GIT_CONFIG_VALUE_{slot}=")))
            .map(str::to_string)
    };
    assert_eq!(
        value_of("core.hooksPath").as_deref(),
        Some("/dev/null"),
        "{env:?}"
    );
    assert_eq!(
        value_of("commit.gpgSign").as_deref(),
        Some("false"),
        "{env:?}"
    );
}

/// A push or fetch that is stopped never held the index lock; a lock there is
/// another run's — git in Terminal, say — and is left alone.
#[test]
fn a_stopped_network_run_leaves_the_index_lock_alone() {
    let bin = fake(
        "git",
        "mkdir -p .git && touch .git/index.lock && echo started\nexec sleep 30",
    );
    let vault = tempfile::tempdir().unwrap();
    let limits = Limits {
        local: Duration::from_secs(3600),
        network: Duration::from_secs(3),
    };
    let host = host_in(&[bin.path()], None, limits);
    let output = host
        .git_in_vault(vault.path(), &args(&["fetch", "--quiet", "origin"]))
        .unwrap();
    assert_eq!(output.code, None);
    assert!(vault.path().join(".git/index.lock").exists());
}

/// A lock older than the stopped run was not made by it, so it is not its to remove.
#[test]
fn a_stopped_local_run_leaves_an_older_lock_alone() {
    let vault = tempfile::tempdir().unwrap();
    fs::create_dir(vault.path().join(".git")).unwrap();
    let lock = vault.path().join(".git/index.lock");
    fs::write(&lock, "").unwrap();
    fs::File::options()
        .write(true)
        .open(&lock)
        .unwrap()
        .set_modified(std::time::SystemTime::now() - Duration::from_secs(3600))
        .unwrap();
    let bin = fake("git", "exec sleep 30");
    let limits = Limits {
        local: Duration::from_secs(1),
        network: Duration::from_secs(3600),
    };
    let host = host_in(&[bin.path()], None, limits);
    let output = host
        .git_in_vault(vault.path(), &args(&["add", "--all"]))
        .unwrap();
    assert_eq!(output.code, None);
    assert!(lock.exists());
}

/// Git's own rules for a branch name (`git check-ref-format`), and never an option.
#[test]
fn a_branch_git_refuses_is_refused() {
    for branch in [
        "origin/a..b",
        "origin/-x",
        "origin/x.lock",
        "origin/a@{1}",
        "origin/a~1",
        "origin/a^",
        "origin/a:b",
        "origin/a b",
        "origin/.hidden",
        "origin/a/.b",
        "origin/a*",
        "origin/a?",
        "origin/a[b",
        "origin/a\\b",
        "origin/a/",
        "origin/a.",
        "origin/@",
        "origin/a//b",
        "origin/a\u{7f}",
    ] {
        assert!(
            !vault_ok(&["rev-parse", "--verify", "--quiet", branch]),
            "{branch:?} is not a branch git allows"
        );
    }
}

/// An address that carries a login or a token would put it in `.git/config`
/// and hand it back to the webview (ADR-0017); the host refuses it too.
#[test]
fn an_address_with_a_login_in_it_is_refused() {
    for url in [
        "https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/james/vault.git",
        "https://james:secret@github.com/james/vault.git",
        "ssh://git:hunter2@github.com/james/vault.git",
    ] {
        assert!(!is_url(url), "{url}");
    }
    assert!(is_url("ssh://git@github.com/james/vault.git"));
    assert!(is_url("git@github.com:james/vault.git"));
}

/// The sync files live in the vault's own `.git/atlas-sync/`, and only the
/// two TypeScript keeps there; a vault whose `.git` is not a folder of its own
/// has none.
#[test]
fn a_sync_file_round_trips_and_only_the_two_names_are_allowed() {
    let host = GitHost::default();
    let vault = tempfile::tempdir().unwrap();
    assert!(host.read_sync_file(vault.path(), "journal.json").is_err());
    fs::create_dir(vault.path().join(".git")).unwrap();
    assert_eq!(host.read_sync_file(vault.path(), "journal.json"), Ok(None));
    host.write_sync_file(vault.path(), "journal.json", Some("{\"v\":1}"))
        .unwrap();
    assert_eq!(
        host.read_sync_file(vault.path(), "journal.json"),
        Ok(Some("{\"v\":1}".to_string()))
    );
    assert!(vault.path().join(".git/atlas-sync/journal.json").is_file());
    host.write_sync_file(vault.path(), "journal.json", None)
        .unwrap();
    assert_eq!(host.read_sync_file(vault.path(), "journal.json"), Ok(None));
    // Removing what is not there is what was asked.
    host.write_sync_file(vault.path(), "exclude", None).unwrap();
    for name in ["config", "../config", "HEAD", "hooks/pre-commit", ""] {
        assert!(
            host.write_sync_file(vault.path(), name, Some("x")).is_err(),
            "{name}"
        );
        assert!(host.read_sync_file(vault.path(), name).is_err(), "{name}");
    }
    let huge = "x".repeat(super::MAX_SYNC_FILE + 1);
    assert!(host
        .write_sync_file(vault.path(), "exclude", Some(&huge))
        .is_err());
}

#[test]
fn a_vault_whose_git_is_a_link_has_no_sync_files() {
    let host = GitHost::default();
    let vault = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), vault.path().join(".git")).unwrap();
    assert!(host
        .write_sync_file(vault.path(), "exclude", Some("x"))
        .is_err());
    assert!(!elsewhere.path().join("atlas-sync").exists());
}

/// Listing repositories is one fixed, read-only shape.
#[test]
fn gh_lists_repositories_with_the_one_read_only_shape() {
    let bin = fake("gh", "for arg in \"$@\"; do echo \"$arg\"; done");
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let output = host.list_repos().unwrap();
    assert_eq!(
        output.stdout.lines().collect::<Vec<_>>(),
        [
            "repo",
            "list",
            "--json",
            "name,nameWithOwner,defaultBranchRef,visibility,url",
            "--limit",
            "1000"
        ]
    );
}

// --- A29-01: the second review ------------------------------------------------

/// A `status` that refreshes the index takes its lock, and then a sync's own
/// `add` or `merge` beside it fails; git's optional locks are off (review L5).
#[test]
fn a_run_in_the_vault_takes_no_optional_lock() {
    let bin = fake("git", "for arg in \"$@\"; do echo \"$arg\"; done");
    let vault = tempfile::tempdir().unwrap();
    let host = host_in(&[bin.path()], None, NO_LIMIT);
    let output = host
        .git_in_vault(
            vault.path(),
            &args(&[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ]),
        )
        .unwrap();
    assert!(
        output
            .stdout
            .lines()
            .any(|arg| arg == "--no-optional-locks"),
        "{}",
        output.stdout
    );
}

/// `.git/atlas-sync` that is a link would send the journal and the excludes
/// somewhere else, and read them back from there (review L9).
#[test]
fn a_sync_folder_that_is_a_link_is_refused() {
    let host = GitHost::default();
    let vault = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    fs::create_dir(vault.path().join(".git")).unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), vault.path().join(".git/atlas-sync")).unwrap();
    fs::write(elsewhere.path().join("journal.json"), "from elsewhere").unwrap();
    assert!(host.read_sync_file(vault.path(), "journal.json").is_err());
    assert!(host
        .write_sync_file(vault.path(), "exclude", Some("x"))
        .is_err());
    assert!(!elsewhere.path().join("exclude").exists());
}

/// A sync file that is itself a link is not read through.
#[test]
fn a_sync_file_that_is_a_link_is_not_read_through() {
    let host = GitHost::default();
    let vault = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    fs::create_dir_all(vault.path().join(".git/atlas-sync")).unwrap();
    let secret = elsewhere.path().join("secret");
    fs::write(&secret, "not the vault's").unwrap();
    std::os::unix::fs::symlink(&secret, vault.path().join(".git/atlas-sync/journal.json")).unwrap();
    assert!(host.read_sync_file(vault.path(), "journal.json").is_err());
}

// Issue #8: an empty repository is refused before anything is cloned, by
// asking the remote which branches it has.
#[test]
fn asking_a_remote_for_its_branches_runs_outside_the_vault_and_nothing_else_does() {
    let branches = |url: &str| folder_ok(&["ls-remote", "--heads", "--", url]);
    assert!(branches("git@github.com:james/vault.git"));
    assert!(branches("https://github.com/james/vault.git"));
    assert!(!branches("ext::sh -c x"));
    assert!(!branches("--upload-pack=sh"));
    assert!(!folder_ok(&["ls-remote", "--heads", "/r.git"]));
    assert!(!folder_ok(&[
        "ls-remote",
        "--upload-pack=sh",
        "--heads",
        "--",
        "/r.git"
    ]));
}

// Issue #8: the open vault reached through a link — or through /var, which
// macOS spells /private/var — was not refused as the folder for a clone.
// The host resolves the two folders it is handed; TypeScript compares them.
#[test]
fn the_host_spells_the_open_vault_and_a_picked_folder_as_the_disk_does() {
    let parent = tempfile::tempdir().unwrap();
    let real = parent.path().join("Atlas Vault");
    fs::create_dir(&real).unwrap();
    let link = parent.path().join("Notes");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let canonical = real.canonicalize().unwrap();
    let host = GitHost::default();

    assert_eq!(host.on_disk(&link, Some(&link)).unwrap(), canonical);
    assert_eq!(host.on_disk(&real, None).unwrap_err(), NOT_CHOSEN);
    host.grant(&link).unwrap();
    assert_eq!(host.on_disk(&link, None).unwrap(), canonical);
    // Never a folder it was not handed: not even whether one exists.
    let elsewhere = tempfile::tempdir().unwrap();
    assert_eq!(
        host.on_disk(elsewhere.path(), Some(&link)).unwrap_err(),
        NOT_CHOSEN
    );
    assert_eq!(
        host.on_disk(&parent.path().join("nothing"), Some(&link))
            .unwrap_err(),
        NOT_CHOSEN
    );
}

#[cfg(target_os = "macos")]
#[test]
fn a_vault_under_var_is_spelled_under_private_var() {
    let dir = tempfile::tempdir_in("/var/tmp").unwrap();
    let host = GitHost::default();
    let resolved = host.on_disk(dir.path(), Some(dir.path())).unwrap();
    assert!(
        resolved.starts_with("/private/var/tmp"),
        "{}",
        resolved.display()
    );
}
