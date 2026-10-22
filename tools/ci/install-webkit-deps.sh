#!/usr/bin/env bash
# Installs the system packages WebKit needs on the `perf` job's Ubuntu runner
# (.github/workflows/gate.yml), and keeps the .deb files in the folder it is
# given so the next run can install them with no download (#519): on a cache
# hit, each cached file whose hash matches apt's lists goes into apt's archive,
# and the install fetches only what is left.
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
#   APT_ARCHIVES_DIR  apt's archive folder (default /var/cache/apt/archives);
#     the tests point it at a temp folder.
set -euo pipefail

debs_dir="${1:?usage: install-webkit-deps.sh <deb cache dir>}"
attempt_seconds="${WEBKIT_DEPS_ATTEMPT_SECONDS:-90}"
apt_archives="${APT_ARCHIVES_DIR:-/var/cache/apt/archives}"
mirror_list=/etc/apt/apt-mirrors.txt

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

# Prints "<file> <algorithm> <hash>" for each archive apt would still download
# for these packages, from lines like `'<uri>' <file> <size> SHA512:<hash>`.
# --print-uris prints MD5 unless told otherwise (apt-private/private-install.cc
# sets Acquire::ForceHash to md5sum only when it is unset), hence the option.
archives_to_fetch() {
  # shellcheck disable=SC2086 # one package name per word
  sudo apt-get install --print-uris -qq -y --no-install-recommends \
    -o Acquire::ForceHash=SHA512 $1 |
    sed -En "s/^'[^']*' ([^ ]+) [0-9]+ (SHA256|SHA512):([0-9a-f]+)$/\1 \2 \3/p"
}

# Moves each cached file into apt's archive only when its hash matches apt's
# lists: apt checks just the size of a file already in its archive, so a bad
# cached file would otherwise be installed. A file that does not match is
# deleted and downloaded instead.
stage_verified_debs() {
  local file algorithm hash actual used=0 rejected=0
  while read -r file algorithm hash; do
    [ -f "$debs_dir/$file" ] || continue
    actual="$("$(tr '[:upper:]' '[:lower:]' <<< "$algorithm")sum" "$debs_dir/$file" | cut -d' ' -f1)"
    if [ "$actual" = "$hash" ]; then
      sudo cp "$debs_dir/$file" "$apt_archives/"
      used=$((used + 1))
    else
      echo "::warning::Cached $file does not match its $algorithm in apt's lists; downloading it."
      rm -f "$debs_dir/$file"
      rejected=$((rejected + 1))
    fi
  done < <(archives_to_fetch "$1")
  echo "Cached .deb files: $used match apt's hashes and are used, $rejected did not."
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
  if [ "${WEBKIT_DEBS_CACHE_HIT:-}" = 'true' ]; then
    stage_verified_debs "$packages"
  fi
  # shellcheck disable=SC2086
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
  echo "Kept $(find "$debs_dir" -name '*.deb' | wc -l | tr -d ' ') .deb files for the cache."
}

if attempt 'lists-on-image' || attempt 'update' || { skip_azure_mirror && attempt 'update'; }; then
  keep_downloaded_debs
  exit 0
fi

echo "::error::WebKit's system packages did not install: every download (limit ${attempt_seconds}s each, three tries) failed or timed out (slow apt mirror?). Re-run the job."
exit 1
