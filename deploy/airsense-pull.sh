#!/usr/bin/env bash
# Fast-forward the box to origin/main and restart the API only if it moved.
#
# A script rather than an inline systemd ExecStart= because systemd expands `$`
# itself: `$(git rev-parse HEAD)` written in a unit file is not a command
# substitution to systemd, and escaping it into `$$(...)` is the kind of thing
# that works until somebody edits the line. This is also testable on its own:
#
#   sudo bash deploy/airsense-pull.sh --dry-run
#
# Safety:
#   --ff-only  cannot rewrite history, cannot create a merge commit, cannot
#              resolve a conflict wrongly. Local edits in the working tree make
#              it refuse and exit non-zero, which surfaces in journalctl rather
#              than quietly clobbering them. This box has carried CRLF-only
#              diffs on catalog.json before.
#   restart only on a change, because a restart costs roughly a 17-second cold
#              first request while the archive and the live mesh rebuild.
set -euo pipefail

REPO="${AIRSENSE_REPO:-/home/ubuntu/air_pollution_sense}"
UNIT="${AIRSENSE_UNIT:-uvicorn}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

cd "$REPO"

before="$(git rev-parse HEAD)"
git fetch --quiet origin

target="$(git rev-parse origin/main)"
if [ "$before" = "$target" ]; then
  echo "already at ${before:0:8}; nothing to do"
  exit 0
fi

# Refuse before touching anything if the tree is dirty, with a clearer message
# than the one git gives. Whitespace-only diffs still count: they are somebody's
# line endings, not ours to discard.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "working tree has local changes; refusing to merge. Resolve them on the box first:" >&2
  git status --short >&2
  exit 1
fi

if [ "$DRY" = 1 ]; then
  echo "would fast-forward ${before:0:8} -> ${target:0:8} and restart $UNIT"
  git log --oneline "$before..$target" | head -20
  exit 0
fi

git merge --ff-only --quiet origin/main
after="$(git rev-parse HEAD)"

echo "fast-forwarded ${before:0:8} -> ${after:0:8}"
git log --oneline "$before..$after" | head -20

systemctl restart "$UNIT"
echo "restarted $UNIT"
