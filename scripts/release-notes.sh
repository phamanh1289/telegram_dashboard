#!/usr/bin/env bash
# Release notes (Markdown) for tag $1 = vX.Y.Z, used by .github/workflows/release.yml as the GitHub Release body:
# the tag message's body (the summary written when tagging, see .claude/skills/release), then the commits since the
# previous v* tag grouped by type. Preview locally: bash scripts/release-notes.sh vX.Y.Z
set -euo pipefail
tag=$1
prev=$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null || true)
range=${prev:+$prev..}$tag

summary=$(git for-each-ref "refs/tags/$tag" --format='%(contents:body)')
if [ -n "$summary" ]; then printf '%s\n\n' "$summary"; fi

subjects=$(git log --no-merges --format='%s' "$range" | grep -Ev '^chore\(release\)' || true)
section() { # $1 heading, then grep args picking its subjects; "feat(docs): x" is listed as "**docs**: x"
  local title=$1 lines
  shift
  lines=$(grep "$@" <<<"$subjects" || true)
  if [ -n "$lines" ]; then
    printf '### %s\n%s\n\n' "$title" "$(sed -E 's/^/- /; s/^- [a-z]+\(([^)]*)\)!?: /- **\1**: /; s/^- [a-z]+!?: /- /' <<<"$lines")"
  fi
}
section "Tính năng" -E '^feat'
section "Sửa lỗi" -E '^fix'
section "Khác" -Ev '^(feat|fix)'
