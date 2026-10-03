#!/bin/sh
# ============================================================================
# Publish the game as a clonable public git repository served by the game
# server itself at /git/. Render (or anyone) can clone straight from a
# running instance — no GitHub account required.
#
#   sh tools/publish-git.sh
# ============================================================================
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/repo"
for item in server client single tools package.json README.md Dockerfile DESIGN.md; do
  [ -e "$ROOT/$item" ] && cp -r "$ROOT/$item" "$WORK/repo/"
done
rm -rf "$WORK/repo/client/node_modules" 2>/dev/null || true

cd "$WORK/repo"
git init -q -b main .
git config user.name "LAST CALL build"
git config user.email "build@lastcall.local"
git add -A
git commit -q -m "LAST CALL $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git gc -q
git update-server-info

rm -rf "$ROOT/.gitpub"
cp -r "$WORK/repo/.git" "$ROOT/.gitpub"
echo "published: $(git rev-parse --short HEAD) -> .gitpub/ (served at /git/)"
