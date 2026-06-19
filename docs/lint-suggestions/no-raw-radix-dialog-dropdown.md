# `no-raw-radix-dialog-dropdown` — force feature code through the styled UI wrappers

> **Proposed *new* rule, not a rule-fights-me friction.** Locks in the Phase 1 dialog/dropdown
> primitives from [`docs/specs/frontend-dry-refactor/SPEC.md`](../specs/frontend-dry-refactor/SPEC.md).

**Rule(s):** core `no-restricted-imports` — no new dependency
**Package / scope:** frontend — `frontend/components/**/*.tsx`, except `frontend/components/ui/**`
**Date / branch:** 2026-06-19 · claude/frontend-dry-refactor-audit-e3bsbf

## Anti-pattern to catch
The audit found the Radix `Dialog.Root → Portal → Overlay → Content` scaffold copy-pasted across three
code dialogs (plus a duplicated overlay in `cascade-modal` / `shell-mobile-nav`), and `DropdownMenu`
item classes hand-typed 14+ times in `task-row` / `folder-nav` — even though
`components/ui/dropdown-menu` already exports styled `DropdownMenuItem` / `DropdownMenuContent`. Phase 1
adds the `FormDialog` / `DialogOverlay` wrappers. There's no legitimate reason a feature component
imports the *raw* Radix primitive once the wrappers exist.

## Suggested rule
```js
{
  files: ['frontend/components/**/*.tsx'],
  ignores: ['frontend/components/ui/**'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: 'radix-ui',
        importNames: ['Dialog', 'DropdownMenu'],
        message: 'Import the styled wrapper from components/ui (FormDialog/DialogOverlay, DropdownMenu*) — not the raw Radix primitive.',
      }],
    }],
  },
}
```
(The codebase imports these as `import { Dialog as DialogPrimitive } from 'radix-ui'`, so the
`importNames` named-export match is exact and high-signal.)

## Sequencing
Add **with Phase 1**, after `FormDialog` / `DialogOverlay` land and the styled `DropdownMenu*` exports
(incl. the sub-trigger) exist and are adopted. Can go straight to **error** — there's no gradual call
site to soften for, and the exemption already covers the wrappers.

## False-positive scope / exemptions
- `components/ui/**` is exempt (it *is* the wrapper layer that imports the primitives).
- If a future feature genuinely needs a Radix primitive with no wrapper, the right move is to add the
  wrapper to `components/ui`, not to import the raw primitive — so the rule staying strict is correct.
