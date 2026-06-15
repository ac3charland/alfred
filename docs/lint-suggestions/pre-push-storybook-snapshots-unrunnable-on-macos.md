# pre-push visual-snapshot gate — unrunnable on local macOS

**Rule(s):** `pre-push` husky hook → root `check:slow` → `frontend` `test:storybook`
(jest-image-snapshot baselines in `frontend/__image_snapshots__/`)
**Package / scope:** frontend (the visual-snapshot baselines); affects the global `pre-push` hook
**Date / branch:** 2026-06-14 · feat/code-module-m1-schema

## What happened
On a local **macOS** session, `git push` runs the `pre-push` gate (`check:slow` →
`test-storybook --ci`) and fails on atom snapshots that the branch never touched:

```
Atoms/TextField › Focused › smoke-test
Expected image to be the same size as the snapshot (216x54), but was different (196x54).
 › 7 snapshots failed from 3 test suites.
```

The committed baselines were generated in the **Linux sandbox** (SwiftShader Chromium). macOS
renders the same text at a **different width** (196px vs 216px), so it's a hard *size* mismatch —
not the sub-pixel antialiasing the `failureThreshold: 0.01` percent-tolerance is designed to
absorb (that only compares same-size images). No code change can make it pass; it's purely the
host OS's font metrics.

## Why the rule doesn't fit here
The gate is sound *in CI* — `.github/workflows/ci.yml` runs `check:slow` on `ubuntu-latest`,
matching the baselines, on every PR. But as a **local macOS pre-push** check it is structurally
unpassable for *any* branch, which collides head-on with the absolute "never `git push
--no-verify`" rule: a contributor on macOS cannot push at all without either bypassing the hook
(forbidden) or regenerating the baselines on macOS (which breaks the gate for the Linux sandbox
and CI). The two rules together leave no legal path.

## Suggested change
Make the visual-snapshot portion of `pre-push` host-aware so it doesn't run where it can't pass,
while keeping it authoritative in CI (which already re-runs `check:slow`). Options:
- Gate `test:storybook` in `pre-push` behind a platform check (skip on `darwin`, with a printed
  notice), keeping `check:slow` fully intact in CI; **or**
- Make the snapshot baselines host-portable (e.g. run the test-runner against a containerized
  SwiftShader Chromium locally so macOS matches the Linux baselines); **or**
- Drop the visual snapshots from `pre-push` entirely and rely on the CI `check-slow` job (still
  blocking PR merge), keeping Playwright/E2E in `pre-push`.

## Workaround used meanwhile
None that passes locally — the work is committed and green on `check:fast`, and the branch is
left for the push/PR to happen from the Linux sandbox (where `check:slow` passes), per the
storybook skill's new "macOS can't pass this gate" note.

## Workarounds to rip out if the rule changes
- The storybook skill note "macOS can't pass this gate — push from the Linux sandbox" can be
  trimmed back to just the antialiasing guidance once macOS pushes work.
