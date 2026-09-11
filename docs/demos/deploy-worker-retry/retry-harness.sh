#!/bin/bash
# Runs the REAL deploy script out of .github/workflows/deploy-worker.yml (extracted
# verbatim, never retyped) against a stubbed `npx`, so the retry behaviour can be
# observed without touching Cloudflare. `sleep` is stubbed to keep the run instant.
set -u
root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# --- extract the run: | block verbatim from the committed workflow ---------------
node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
const i = lines.findIndex((l) => l.trim() === "run: |");
const out = [];
for (let j = i + 1; j < lines.length; j++) {
  if (lines[j].startsWith("          ")) out.push(lines[j].slice(10));
  else break;
}
fs.writeFileSync(process.argv[2], out.join("\n") + "\n");
' "$root/.github/workflows/deploy-worker.yml" "$work/deploy.sh"

echo "=== the deploy step, as committed ==="
cat "$work/deploy.sh"

mkdir -p "$work/stub"
printf '#!/bin/bash\nexit 0\n' > "$work/stub/sleep"   # no real waiting in the demo
chmod +x "$work/stub/sleep"

run_case () {
  local name="$1" behavior="$2"
  printf '#!/bin/bash\n%s\n' "$behavior" > "$work/stub/npx"
  chmod +x "$work/stub/npx"
  : > "$work/calls"
  # `bash -e` is exactly the shell GitHub Actions gives a `run:` block.
  PATH="$work/stub:$PATH" GITHUB_SHA=deadbeef CALLS="$work/calls" \
    bash -e "$work/deploy.sh" > "$work/out" 2>&1
  local rc=$?
  echo
  echo "--- $name"
  echo "    exit code ............ $rc"
  echo "    deploys attempted .... $(wc -l < "$work/calls" | tr -d ' ')"
  echo "    retry warnings ....... $(grep -c '::warning::' "$work/out" || true)"
  grep '::error::' "$work/out" | sed 's/^/    /' || true
}

echo
echo "=== behaviour ==="
run_case "deploy succeeds first try"        'echo x >> "$CALLS"; exit 0'
run_case "transient blip, then succeeds"    'echo x >> "$CALLS"; [ "$(wc -l < "$CALLS")" -ge 3 ] && exit 0; exit 1'
run_case "genuinely broken deploy"          'echo x >> "$CALLS"; exit 1'
