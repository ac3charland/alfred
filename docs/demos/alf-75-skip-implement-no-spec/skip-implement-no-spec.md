---
branch: claude/skip-to-implement-prompt-qldnpc
---

# Skip-to-Implement prompt asks for no spec and reads no implement skill (ALF-75)

*2026-07-01T04:33:50.235Z*

ALF-75: the "Skip to Development" (bypass) launch is for a small, well-understood task that skips refinement, so it produces no committed spec. The prompt used to point at the implement-spec skill (which owns spec-consuming conventions like archiving) and carry a `spec-path` in its `alfred` block — both implied a spec file that never exists and is never read. Now the bypass prompt names no spec-path and reads no implement skill: it just asks the user until requirements are clear, then implements against the repo's own conventions.

The helper below builds the real bypass deep link from `frontend/lib/code/links.ts` and inspects the generated prompt. `spec-path line` and `reads implement skill` are now `false`, while `phase: implementation`, the ask-first gate, and the TDD nudge remain — and the `alfred` block carries only the ticket + phase (CI requires spec-path on refinement PRs only, so this block is valid).

```bash
node --no-warnings docs/demos/alf-75-skip-implement-no-spec/build-bypass-prompt.mjs
```

````output
phase implementation : true
spec-path line       : false
reads implement skill: false
asks for spec         : false
keeps ask-first gate : true
keeps TDD nudge       : true
--- alfred block ---
```alfred
alfred-ticket: ALF-4
phase: implementation
```
````
