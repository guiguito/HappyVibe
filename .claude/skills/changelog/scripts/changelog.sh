#!/usr/bin/env bash
# HappyVibe changelog helper. Two modes:
#   digest  — what changed since the last tag, grouped so it can be triaged
#   check   — the mechanical rules a finished entry has to pass
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# The base is the last release. A tag is the normal way to know it, but the tag
# is cut by hand AFTER the release commit, so there is a real window where it is
# missing — and falling back to the first commit silently turns "what shipped in
# this release" into "the entire history". Say so loudly, and take an override.
base_ref() {
  if [ -n "${2:-}" ]; then echo "$2"; return; fi
  git describe --tags --abbrev=0 2>/dev/null && return
  echo "__NONE__"
}

runtime_line() {
  node -e "const d=require('./pi-runtime/package.json').dependencies;
    console.log('Runtime: Pi '+d['@earendil-works/pi-coding-agent']+
      ' · sub-agents '+d['pi-subagents']+' · MCP adapter '+d['pi-mcp-adapter'])"
}

case "${1:-digest}" in
digest)
  BASE=$(base_ref "$@")
  echo "### Range"
  if [ "$BASE" = "__NONE__" ]; then
    BASE=$(git rev-list --max-parents=0 HEAD)
    echo "!! NO TAG FOUND — this is the ENTIRE history, not one release."
    echo "!! If a release already shipped, pass its commit or tag:"
    echo "!!     changelog.sh digest <ref>      e.g. changelog.sh digest v0.1.0"
    echo "!! Otherwise everything below is the whole project and the triage will"
    echo "!! re-describe features the user already has."
    echo
  fi
  echo "from ${BASE} to HEAD"
  echo "$(git log --no-merges --oneline "$BASE"..HEAD | wc -l | tr -d ' ') non-merge commits, $(git log --merges --oneline "$BASE"..HEAD | wc -l | tr -d ' ') merged PRs"
  echo
  echo "### Commits by type and scope — read this FIRST, it is your grouping key"
  git log --no-merges --format='%s' "$BASE"..HEAD \
    | sed -nE 's/^([a-z]+)(\(([^)]+)\))?!?: .*/\1 \3/p' \
    | awk '{t=$1; s=($2==""?"(none)":$2); c[t" "s]++} END {for (k in c) printf "%5d  %s\n", c[k], k}' \
    | sort -k2,2 -k1,1rn
  echo
  echo "### feat — the candidates. One bullet per SCOPE, not per commit."
  git log --no-merges --format='%s' "$BASE"..HEAD | grep -E '^feat' | sort || echo "(none)"
  echo
  echo "### fix — most of these earn nothing. Only a fix to something a PREVIOUS release shipped counts."
  git log --no-merges --format='%s' "$BASE"..HEAD | grep -E '^fix' | sort || echo "(none)"
  echo
  echo "### perf / revert — read these, they are rare and usually visible"
  git log --no-merges --format='%s' "$BASE"..HEAD | grep -EI '^(perf|revert)' || echo "(none)"
  echo
  echo "### Renderer files touched — which SURFACES moved"
  git diff --name-only "$BASE"..HEAD -- src/renderer | sed 's|.*/||' | sort -u | tr '\n' ' ' || true
  echo; echo
  echo "### Pins, as the line to paste"
  runtime_line
  ;;

check)
  fail=0
  echo "### Rule 1 — no commit prose"
  if grep -nE '^[[:space:]]*[-*][[:space:]]*(feat|fix|chore|docs|refactor|test|perf|style|ci)[[:space:]]*[(:]' CHANGELOG.md; then
    echo "FAIL — those are commit subjects, not sentences. Rewrite as what the user can now do."; fail=1
  else echo "ok"; fi

  echo "### Rule 3 — bullet count in the top entry"
  n=$(awk '/^## /{c++} c==1 && /^[[:space:]]*- /' CHANGELOG.md | wc -l | tr -d ' ')
  echo "$n bullets"
  [ "$n" -gt 20 ] && echo "WARN — past ~20 you are transcribing the log. Group harder." || true

  echo "### Rule 5 — no paths, PR numbers or file names"
  if grep -nE '\bsrc/|\.tsx?\b|#[0-9]{2,}' CHANGELOG.md; then
    echo "FAIL — internal detail the user cannot act on."; fail=1
  else echo "ok"; fi

  echo "### Pins line present and current"
  want=$(runtime_line)
  if grep -qF "$want" CHANGELOG.md; then echo "ok — $want"
  else echo "FAIL — top entry needs: $want"; fail=1; fi

  echo "### Invariant — top released entry equals package.json"
  top=$(grep -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | head -1 | tr -d '#[] ' || true)
  pkg=$(node -p "require('./package.json').version")
  if [ -z "$top" ]; then echo "skipped — nothing released yet (package.json says $pkg)"
  elif [ "$top" = "$pkg" ]; then echo "ok — $top"
  else echo "FAIL — CHANGELOG says $top, package.json says $pkg"; fail=1; fi

  exit "$fail"
  ;;
*) echo "usage: changelog.sh [digest|check]" >&2; exit 2 ;;
esac
