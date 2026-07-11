#!/usr/bin/env bash
# Auto-commit watcher: watches this repo and commits+pushes every change to main.
# Zero dependencies (polling via `git status`). Respects .gitignore, so .env / secrets
# are NEVER staged. Pushing to main triggers the Vercel deploy GitHub Action.
#
# Usage:  ./scripts/auto-commit.sh            (foreground)
#         nohup ./scripts/auto-commit.sh >/tmp/novel-autocommit.log 2>&1 &   (background)
# Stop:   find the PID and `kill` it, or Ctrl-C in the foreground.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

INTERVAL="${AUTOCOMMIT_INTERVAL:-5}"   # poll seconds
SETTLE="${AUTOCOMMIT_SETTLE:-3}"       # quiet-period seconds before committing
BRANCH="${AUTOCOMMIT_BRANCH:-main}"

echo "[auto-commit] watching $REPO_DIR -> origin/$BRANCH (poll ${INTERVAL}s, settle ${SETTLE}s)"

while true; do
  if [ -n "$(git status --porcelain)" ]; then
    # settle: wait, then require the tree to still be dirty and stable before committing
    sleep "$SETTLE"
    before="$(git status --porcelain | md5 2>/dev/null || git status --porcelain | md5sum)"
    sleep "$SETTLE"
    after="$(git status --porcelain | md5 2>/dev/null || git status --porcelain | md5sum)"
    if [ "$before" != "$after" ]; then
      continue   # still being edited; loop again
    fi
    git add -A
    if [ -z "$(git diff --cached --name-only)" ]; then
      continue   # everything staged is gitignored / nothing to commit
    fi
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    git commit -q -m "auto: $ts" || true
    # push; if remote moved, rebase then retry once
    if ! git push -q origin "$BRANCH" 2>/dev/null; then
      git pull --rebase -q origin "$BRANCH" || true
      git push -q origin "$BRANCH" || echo "[auto-commit] push failed at $ts"
    fi
    echo "[auto-commit] committed & pushed at $ts"
  fi
  sleep "$INTERVAL"
done
