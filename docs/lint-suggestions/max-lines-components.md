# `max-lines-components` — flag the next 1100-line component before it grows

> **Proposed *new* rule, not a rule-fights-me friction.** Advisory back-pressure behind the Phase 2
> decomposition in [`docs/specs/frontend-dry-refactor/SPEC.md`](../specs/frontend-dry-refactor/SPEC.md).

**Rule(s):** core `max-lines` (warn) — no new dependency
**Package / scope:** frontend — `frontend/components/**/*.tsx`
**Date / branch:** 2026-06-19 · claude/frontend-dry-refactor-audit-e3bsbf

## Anti-pattern to catch
`task-row.tsx` reached **1107 lines** mixing layout, a dropdown menu, three inline editors, an exit
animation, and data orchestration. There's no signal that warns when a component is sliding toward that
size. A file-length warning is a cheap, deterministic tripwire.

## Suggested rule
```js
{
  files: ['frontend/components/**/*.tsx'],
  rules: {
    'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
  },
}
```
Keep it a **warn** (like skill-lint's `body-length`): a big file is sometimes justified, and a hard
error would block legitimate work. The threshold is a starting point — tune after Phase 2 lands and the
known offenders (`task-row`, `board`, `story-detail-modal`) are decomposed, so the ceiling reflects the
post-refactor norm rather than the pre-refactor outliers.

## Sequencing
Add **with Phase 2**, after the three large components are decomposed — otherwise it fires loudly on
exactly the files the phase is already fixing.

## False-positive scope / exemptions
- Consider exempting generated files and stories.
- `max-lines-per-function` is a possible companion but is noisier on JSX-heavy render bodies; start
  with file-level `max-lines` only and revisit if needed.
