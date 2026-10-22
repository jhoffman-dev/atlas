#!/usr/bin/env bash
# Installs the system packages WebKit needs on the `perf` job's Ubuntu runner
# (.github/workflows/gate.yml), and keeps the .deb files in the folder it is
# given so the next run can install them with no download (#519): on a cache
# hit they are already in apt's archive, and the first attempt fetches nothing.
#
# The azure apt mirror sometimes trickles: `apt-get update` once sat for eight
# minutes on a package list. So downloads run under a time limit and are
# retried, first from the lists the image already has (no update at all), then
# after an update, then after an update that skips the azure mirror. Only the
# download is time-limited; dpkg is never killed mid-install.
#
# Usage: tools/ci/install-webkit-deps.sh <deb cache dir>
#   WEBKIT_DEBS_CACHE_HIT=true  the folder was restored from the cache
#   WEBKIT_DEPS_ATTEMPT_SECONDS  each download's limit (default 90). At most five
#     run, 7.5 minutes, which fits inside the step's 9-minute limit.
set -euo pipefail

debs_dir="${1:?usage: install-webkit-deps.sh <deb cache dir>}"
attempt_seconds="${WEBKIT_DEPS_ATTEMPT_SECONDS:-90}"
apt_archives=/var/cache/apt/archives
mirror_list=/etc/apt/apt-mirrors.txt

# Puts the cached files where apt looks for packages it has already downloaded,
# so the install below fetches nothing that matches them. (Handing apt the
# files by path does not work with --no-download: it still "fetches" them.)
restore_cached_debs() {
  if compgen -G "$debs_dir/*.deb" > /dev/null; then
    sudo cp "$debs_dir"/*.deb "$apt_archives"/
  fi
}

# Prints the packages WebKit still lacks, one per line, as Playwright's own
# dependency list and apt's lists see them. Fails when apt cannot answer, for
# example because a package is missing from stale lists.
missing_packages() {
  local report
  # Exits 1 when something is missing, which is the answer, not an error.
  report="$(pnpm exec playwright install-deps --dry-run webkit 2>&1)" || true
  if grep -q 'All system dependencies are installed' <<< "$report"; then
    return 0
  fi
  grep -q '^Missing system dependencies' <<< "$report" || {
    echo "$report" >&2
    return 1
  }
  sed -n 's/^  \([^ ][^ ]*\)$/\1/p' <<< "$report"
}

# One try: optionally refresh the lists, then download and install what is missing.
attempt() {
  local refresh="$1" packages
  if [ "$refresh" = 'update' ]; then
    sudo timeout "$attempt_seconds" apt-get update || return 1
  fi
  packages="$(missing_packages)" || return 1
  if [ -z "$packages" ]; then
    echo 'WebKit needs no system packages on this image.'
    return 0
  fi
  # shellcheck disable=SC2086 # one package name per word
  sudo timeout "$attempt_seconds" apt-get install -y --no-install-recommends --download-only $packages || return 1
  # shellcheck disable=SC2086
  sudo apt-get install -y --no-install-recommends --no-download $packages
}

skip_azure_mirror() {
  if [ -f "$mirror_list" ]; then
    sudo sed -i '/azure\.archive\.ubuntu\.com/d' "$mirror_list"
  fi
}

keep_downloaded_debs() {
  mkdir -p "$debs_dir"
  if compgen -G "$apt_archives/*.deb" > /dev/null; then
    cp "$apt_archives"/*.deb "$debs_dir"/
  fi
  echo "Kept $(find "$debs_dir" -name '*.deb' | wc -l) .deb files for the cache."
}

if [ "${WEBKIT_DEBS_CACHE_HIT:-}" = 'true' ]; then
  restore_cached_debs
fi

if attempt 'lists-on-image' || attempt 'update' || { skip_azure_mirror && attempt 'update'; }; then
  keep_downloaded_debs
  exit 0
fi

echo "::error::WebKit's system packages did not install: every download (limit ${attempt_seconds}s each, three tries) failed or timed out (slow apt mirror?). Re-run the job."
exit 1
