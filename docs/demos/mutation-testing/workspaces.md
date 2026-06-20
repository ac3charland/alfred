---
branch: claude/mutation-testing-workspaces-a8rfow
---

# Mutation testing: kill surviving mutants across workspaces

*2026-06-20T04:56:43.791Z*

Ran `npm run mutation` in every workspace that has it (`workers`, `tools/showboat`, `frontend`) and drove each *survived* mutant to either a kill (a new or strengthened assertion in the tests) or a documented `// Stryker disable next-line <Mutator>: AT_CEILING — <why>` marker for the genuinely-equivalent ones.

**workers**: 82.97% with 40 survived + 7 no-coverage → **100.00%, 0 survived, 0 no-coverage**. New tests pin the HTTP routing 404s (wrong method/path), the invalid-JSON 400, the no-op-action 200, partial ticket-match filtering, every branch of the spec-snapshot guard, and the response bodies/headers. At-ceiling: the redundant `Content-Type` header (Response.json already sets it), the importKey `extractable` flag, the constant-time-compare loop bound, and two unanchored-regex variants the unanchored field parses can't observe.

**tools/showboat**: 37 survived → **0 survived**. A new `run.test.ts` exercises the `node`/`js`/`python` interpreter aliases, lang trim+lowercase, maxBuffer, output-newline trimming, and signal-kill status (`status === null → 1`); added video gif-numbering, git-remote and doc-path normalization, and multi-line / stray-`---` front-matter parsing. At-ceiling: the scheme/scp prefix-strip regexes (a downstream last-two-path-segments parse makes every internal variant unobservable), the git-delegating optional chains, `NO_COLOR`, the spawn-error fallback, and the ffmpeg filter string (only reached by ffmpeg.wasm, which the tests stub).

**frontend**: in progress — see the follow-up commit on this branch. (Its mutation pass over the full app/components/lib surface is the long pole.)

Reproduce per workspace: `npm run mutation -w workers` / `-w tools/showboat` / `-w frontend`. The summary table prints the score and the surviving/no-coverage counts; the HTML report at `<pkg>/reports/mutation/mutation.html` lists any remaining survivors with the exact file:line and mutation. Gotcha recorded in the `stryker` skill: a `// Stryker disable next-line` comment wedged *between* chained `.replace()` calls is silently ignored — it must sit directly above a statement, so the prefix-strip chain was split into separate statements.
