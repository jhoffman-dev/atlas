# Security policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue or pull request.
Use GitHub's private vulnerability reporting: on
[jhoffman-dev/atlas](https://github.com/jhoffman-dev/atlas), open the **Security** tab
and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and what it lets an attacker do. You will
get an acknowledgement, and a fix or a decision will be shared in the advisory before
anything is made public.

## Supported versions

Only the latest `main` is supported. Atlas is a local-first desktop app with no hosted
service, so reports about the app itself, its local HTTP/MCP API, the sync path and the
handling of stored secrets are all in scope.

## CI integrity

A pull request runs the workflow as that pull request wrote it, so a change under
`.github/` or `tools/ci/` can weaken or skip the very checks that judge it. A green
`gate` on such a pull request proves less than it does elsewhere. Three things stand
in for that:

- Whoever merges reads every line of the diff under `.github/` and `tools/ci/` first.
  `.github/CODEOWNERS` names the owner of both, but with one maintainer it is
  advisory: an owner cannot review their own pull request, so the reading is the
  control and the file is only a reminder of it.
- The workflow's token is read-only, no checkout leaves credentials behind, and
  third-party actions are pinned to a commit rather than a tag.
- Workflows on pull requests from forks should wait for approval. The recommended
  repository setting, under **Settings → Actions → General → Approval for running
  fork pull request workflows from contributors**, is **Require approval for all
  external contributors** (older screens call them outside collaborators).
