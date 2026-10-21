# Changelog

Every release of the app, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/). How to cut one: [RELEASING.md](RELEASING.md).
Each release's GitHub notes list the pull requests merged for it.

## [Unreleased]

## [0.1.0] — not yet released

The first versioned release.

### Added

- Semantic versioning from v0.1.0, with one version across every package and manifest
  (`pnpm version:set`, `pnpm version:check`).
- Settings → About shows the version and the commit the app was built from; the local
  API's `GET /v1/status` reports both (`version`, `build`), and the MCP server reports
  the version.
- A release workflow that builds a downloadable `.dmg` for Apple silicon and attaches it
  to a draft GitHub Release.

[Unreleased]: https://github.com/jhoffman-dev/atlas/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jhoffman-dev/atlas/releases/tag/v0.1.0
