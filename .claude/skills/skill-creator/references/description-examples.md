# Description before/after library

A growing set of real description fixes — each a concrete *before → after* with the smell it
cures. Read it when **writing or editing any skill description**: skim for the smell your
draft might have, then check your draft against the matching pair. The *rules* and their
*reasoning* live in [`description-triggering.md`](description-triggering.md); this file is the
worked examples, so don't restate the theory here — add a pair.

grep for a smell: `grep -iE 'inlines|repo name|enumerates|buried|rationale' description-examples.md`

## Inlines the skill's content (especially at the front)

A description says *what the skill covers and when to reach for it* — not the skill's actual
guidance. Spelling out the rules reproduces the body, drifts from it, and burns the
front-loaded triggering budget. Name the subject; stop there.

❌ **Before** (`backpressure`):
> Documents how the deterministic checks (the back-pressure gates) are wired — where a check
> belongs and which tier runs it. **A package's own typecheck/lint/format/test lives in that
> workspace's check:fast/check:slow; a monorepo-wide check (linting all of .claude/skills/ or
> docs/demos/) lives in the root check command. Covers the pre-commit (fast) vs pre-push
> (slow) tier choice.** Use when adding or moving a check…

✅ **After** — cut the bolded sentences; the framing ("where a new check belongs and which tier
runs it") already names the subject, and the body holds the answer:
> Documents how the deterministic checks (the back-pressure gates) are wired — where a new
> check belongs and which tier runs it. Use when adding or moving a check, linter, or gate…

The trap compounds when you *also* cut the trigger keywords to make room for the inlined
content — the worst of both: less triggering, more body leak. Fix it by doing the opposite.

❌ **Before** (`motion`) — the front is the rule content (the exact tokens, the mount→fade
mechanism, the matchMedia gotcha), and the keyword list was thinned to fit it:
> Documents the frontend's motion conventions: the reusable animation design tokens (the
> `--animate-*` theme tokens in globals.css, e.g. `animate-fade-in` / `animate-fade-out`), the
> pattern for revealing/collapsing content with a fade (mount → fade-in, fade-out → unmount),
> how to add a new motion token, and the jsdom `matchMedia` gotcha… — "fade in/out",
> "transition", "animate", "reveal", "collapse", "reduced motion".

✅ **After** — name the subject in a phrase, then spend the budget on the *keywords* a user types:
> Documents the frontend's motion conventions — animation tokens, fade/slide reveals,
> expand/collapse, and prefers-reduced-motion handling. Use whenever… — "fade in/out",
> "animate-fade-in", "matchMedia", "useSyncExternalStore for media query", "add a motion token"…

`matchMedia` and `--animate-*` belong in the description — but as **trigger words a user types**,
not as a "the jsdom matchMedia gotcha" rule summary. Same token, opposite role.

The tell: if a sentence would answer "*how does the skill say to do it?*", it's body content.
Subject-naming answers "*what is this about?*" instead.

❌ **Before** (`migration-lint`) — the second sentence is the rule's *mechanism* (what it checks
and the error it prevents), pure body content; its keywords were already in the trigger list, so
it buys nothing but leak:
> Covers migration-lint, the static linter over database/migrations/\*.sql that runs in the
> global check:fast (pre-commit). **Its sequence-grant rule fails the build when a created
> sequence has no USAGE grant to anon/authenticated/service_role — the latent "permission denied
> for sequence" 500.** Use when running or interpreting migration-lint…

✅ **After** — name the rule as a subject and stop; `sequence-grant` and `permission denied for
sequence` stay only in the trigger list, as words a user types:
> Covers migration-lint, the static linter over database/migrations/\*.sql that runs in the
> global check:fast (pre-commit) — its sequence-grant rule. Use when running or interpreting
> migration-lint… Trigger on: …, "sequence-grant", "permission denied for sequence", …

This pair shipped **after** the `backpressure` pair above was already in this library — proof
that reading the rule isn't the safeguard. The safeguard is the **re-read-and-cut pass on your
own draft**: after writing, ask each sentence "*what is this about?*" vs "*how does it work?*"
and delete every *how*. That pass is the step that actually catches it.

## States the rationale (the WHY) instead of what + when

A description routes the agent: it needs *what the skill does* and *when to read it*, not *why
the skill exists*. Motivating prose explains a decision the agent doesn't have to make to decide
whether to open the skill, so it's body material burning the triggering budget.

❌ **Before** (`batch-commits`) — the middle sentence justifies the skill:
> Use when a finished, green change needs several logical commits without re-running the
> pre-commit gate on each. **The pre-commit hook runs `npm run check:fast` per commit, so N
> commits the normal way run that check N times.** This skill's bundled script … runs the gate
> once, then creates all the commits…

✅ **After** — drop the justification; keep what it does and when:
> Use when a finished, green change needs to be committed as several logical commits without
> re-running the pre-commit gate on each. This skill's bundled script … runs the gate once, then
> creates all the commits…

## Enumerates every rule/item the skill contains

A variant of inlining: listing each rule, command, or option turns the description into a
table of contents and forces a re-edit every time the skill grows. **Rephrasing the list as
prose is not enough** — it's the same enumeration in different words. Name the *kind* of thing
the skill covers and let the body hold the list.

❌ **Before** (`skill-lint`) — an explicit count + list, stale the moment a rule is added:
> …runs inside check:fast. **Four rules ship today: a description-length error (the
> ~1024-char cap), a description-no-repo-name error, a body-length warning (over ~500 lines),
> and a compound-TOC error…**

⚠️ **Still too verbose** — the count is gone, but it still enumerates every failure mode:
> …runs inside check:fast — **flagging descriptions that exceed the char cap, run
> long/verbose, or name the repo, bodies past ~500 lines, and compound skills missing a Table
> of Contents.**

✅ **After** — name the subject; the rules table in the body is the list:
> Covers skill-lint, the linter that **checks SKILL.md files for deterministic failure modes.**

The nominalized variant is the sneakiest: a `subject: a, b, c` colon-list where each item is
*advice*, not a subject-noun. A house-style skill has no inventory of subjects to list, so the
list is always the body leaking in.

❌ **Before** (`implement-spec`):
> Documents the house style for implementing a written spec, ticket, or design doc: which of
> the spec's references belong in the resulting code, comments, commits, PRs, and tests versus
> what to leave behind, plus grounding in the existing codebase first, handling a spec that's
> ambiguous or has drifted, and test coverage. Read whenever… Trigger on: …

✅ **After** — name the subject in one phrase; the rules live in the body:
> Documents the house style for implementing a written spec, ticket, or design doc into code.
> Read whenever you've been handed a spec, ticket, or design doc and asked to build it. Trigger
> on: "implement this spec", "build the spec", …

## Names the repo (redundant scope)

The agent already knows which repo it's in (CLAUDE.md), so the repo name is wasted scope in
the highest-value position — and `skill-lint`'s `description-no-repo-name` rule now errors on
it. Drop it, or disambiguate *which part* with "the frontend" / "the monorepo".

❌ **Before** → ✅ **After**:
- `dnd-kit`: "Covers dnd-kit drag-and-drop **in alfred's frontend**" → "…**in the frontend**"
- `batch-commits`: "the only sanctioned use of --no-verify **in alfred**" → "…**in the repo**"
- `git`: "Covers git CLI workflows **in alfred**" → "…**in the monorepo**"
