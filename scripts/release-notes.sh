#!/usr/bin/env bash
# Release notes (Markdown) for tag $1 = vX.Y.Z, used by .github/workflows/release.yml as the GitHub Release body.
# One language after the other: the tag message's body (the summary written when tagging, see
# .claude/skills/release-notes) holds "## Tiếng Việt" then "## English"; the commits since the previous v* tag follow,
# grouped by type with English headings, so they close the English half (commit subjects are English). The app's
# update dialog shows only the half in its language. Preview locally: bash scripts/release-notes.sh vX.Y.Z
# $2 (optional): a file with the summary to use instead of the tag's (rewriting a published release's notes).
set -euo pipefail
tag=$1
git rev-parse -q --verify "refs/tags/$tag" >/dev/null || { echo "no tag $tag" >&2; exit 1; }
prev=$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null || true)
range=${prev:+$prev..}$tag

if [ -n "${2:-}" ]; then summary=$(cat "$2"); else summary=$(git for-each-ref "refs/tags/$tag" --format='%(contents:body)'); fi
if [ -n "$summary" ]; then
  # Vietnamese first, then English: anything else reads half and half, and the app can't pick its language's half
  heads=$(grep -E '^## ' <<<"$summary" | sed -E 's/[[:space:]]+$//' | paste -sd '|' - || true)
  [ "$heads" = "## Tiếng Việt|## English" ] ||
    echo "warning: $tag's summary should have exactly '## Tiếng Việt' then '## English' as its ## headings" >&2
  printf '%s\n\n' "$summary"
fi

subjects=$(git log --no-merges --format='%s' "$range" | { grep -Ev '^chore\(release\)' || true; })
section() { # $1 heading, then grep args picking its subjects; "feat(docs): x" is listed as "**docs**: x"
  local title=$1 lines
  shift
  lines=$(grep "$@" <<<"$subjects" || true)
  if [ -n "$lines" ]; then
    printf '### %s\n%s\n\n' "$title" "$(sed -E 's/^/- /; s/^- [a-z]+\(([^)]*)\)!?: /- **\1**: /; s/^- [a-z]+!?: /- /' <<<"$lines")"
  fi
}
section "Features" -E '^feat(\(|!|:)'
section "Fixes" -E '^fix(\(|!|:)'
section "Other" -Ev '^(feat|fix)(\(|!|:)'
