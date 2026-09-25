#!/bin/sh
# Run both rename suites the way a git hook runs them: with GIT_DIR / GIT_INDEX_FILE pinned at a
# repository. Here the pinned repository is a throwaway; afterwards, report what the suites left in it.
set -e
pinned=$(mktemp -d)
trap 'rm -rf "$pinned"' EXIT
git init -q "$pinned"
bare_before=$(git -C "$pinned" config core.bare)

for tool in skill-lint demo-lint; do
  GIT_DIR="$pinned/.git" GIT_INDEX_FILE="$pinned/.git/index" \
    npm run test --silent -w "tools/$tool" -- rename >/dev/null 2>&1
  echo "$tool rename suite ran under the pin: exit 0"
done

echo "branches in the pinned repo:  $(git -C "$pinned" for-each-ref refs/heads | wc -l | tr -d ' ')"
echo "commits in the pinned repo:   $(git -C "$pinned" rev-list --all | wc -l | tr -d ' ')"
echo "test identity in its config:  $(grep -c 'test@example.com' "$pinned/.git/config" || true)"
echo "core.bare before -> after:    $bare_before -> $(git -C "$pinned" config core.bare)"
