# Compounding-Learning Anti-Patterns

Real before/after examples from this repo's history. Each case is labeled with the anti-pattern, a one-line description of what went wrong, and the diff that fixed it.

## Contents

- [Meta-comments](#meta-comments) — origin notes, "ported from", historical context, supersession markers
- [Stale and contradicted content](#stale-and-contradicted-content) — outdated gotchas, sections invalidated by later changes
- [Setup-only gotchas in the main body](#setup-only-gotchas-in-the-main-body) — one-time wiring details that don't apply to routine use
- [Verbosity](#verbosity) — over-explained rationale, redundant forwarding hints, bloated bullets
- [Wrong-skill placement](#wrong-skill-placement) — gotchas recorded in a skill where they won't be read together with the relevant code

---

## Meta-comments

Content about how a section got there — origin notes, migration markers, historical explanations for decisions that are no longer active. None of this helps a future agent; it only adds noise.

### Example: section heading with origin annotation

The supabase skill's security-traps heading revealed how the content was sourced. Agents don't need to know; only the content matters.

**Before:**
```markdown
### Security traps (folded in from Supabase's first-party skill)
```

**After:**
```markdown
### Security traps
```

### Example: "Historical note" block for a decision that's been reversed

The shadcn skill once contained a full section explaining that `lib/utils.ts` was renamed to `lib/utilities.ts` and then renamed back. This history is not actionable — agents just need to know the current name.

**Before:**
```markdown
## `lib/utils.ts` is the standard path — keep it

shadcn/ui's default CLI output creates `lib/utils.ts`...

> Historical note: alfred once renamed this to `lib/utilities.ts` to satisfy
> `unicorn/prevent-abbreviations`... That rule was deliberately disabled
> project-wide... The standard `lib/utils.ts` is back.
```

**After:** Section deleted entirely. The fact that `lib/utils.ts` is the standard path is conveyed by following shadcn defaults — no rule needed.

### Example: blockquote calling out a superseded section

When the storybook skill gained a new Visual Regression section (§7), the agent didn't remove the old "alfred does NOT do visual regression" note in §8. Instead it added a blockquote at the top of §7 explaining that §8 was now obsolete.

**Before (added to the top of the new §7):**
```markdown
> alfred **does** do visual regression — the §8 note that it "does not" is obsolete.
> The official **Writing Tests → Visual Testing** page documents **Chromatic** only…
```

**After:** Blockquote deleted. The old §8 "does not" note was also removed (see [Stale and contradicted content](#stale-and-contradicted-content)).

The fix is always to remove the contradicted content, not to annotate it as obsolete.

---

## Stale and contradicted content

Content that was once accurate but is no longer true — either because the project changed, or because a new section was added that says the opposite.

### Example: gotcha for a rule that was later configured away

The supabase skill documented a workaround for `unicorn/no-null` conflicting with `.is('column', null)`. When the project disabled that rule configuration, the workaround became misleading — agents following it would write contorted code for a constraint that no longer exists.

**Before:**
```markdown
- **`.is('column', null)` conflicts with `unicorn/no-null` when the rule has
  `checkArguments: true`.** The Supabase `.is()` type signature is
  `(column: string, value: boolean | null): this` — `null` is mandatory. If the
  project's ESLint config has `unicorn/no-null` with `checkArguments: true` and you
  cannot use `eslint-disable`, use `const DB_NULL = undefined as unknown as null`
  and pass `DB_NULL` instead.
```

**After:** Entry removed entirely once `unicorn/no-null` was no longer configured that way.

### Example: new section added without removing the section it contradicts

(See also the storybook blockquote example above.) The general pattern: agent adds correct new content but leaves the old wrong content in place, then adds a note pointing at the contradiction rather than resolving it. The fix is always: delete the old content, remove the annotation.

---

## Setup-only gotchas in the main body

One-time setup details, wiring gotchas, and config scaffolding that's only relevant when standing up a feature for the first time. In the main body, they inflate reading time for every agent that opens the skill to write a test or use a tool — even though 95% of those agents will never need them.

Rule: if the agent would only need this when setting up the feature from scratch or debugging a setup-level failure, it belongs in `references/`.

### Example: playwright wiring gotchas dumped in main body

When the Playwright integration suite was wired up, seven specific gotchas from that process were recorded directly in the skill body under `### Gotchas hit wiring this up`. These include things like `import.meta` breaking the CJS config loader, `.ts` extension import errors, and UUID seed id requirements.

These are genuinely useful — but they're only needed when someone is wiring the suite, not writing tests. An agent authoring a spec doesn't benefit from reading them.

**Before:** Seven-bullet `### Gotchas hit wiring this up` section in SKILL.md body.

**After:** Moved to `references/setup-and-wiring.md`. Main body replaced with:
```markdown
> **Setting up the suite, editing config, or debugging a setup-level failure?**
> The full `playwright.config.ts` / `auth.setup.ts` reference, the Storybook
> test-runner browser config, and the gotchas hit wiring this suite up live in
> [`references/setup-and-wiring.md`](references/setup-and-wiring.md).
```

### Example: `playwright.config.ts` reference template inline in skill body

A full `playwright.config.ts` TypeScript template and `auth.setup.ts` boilerplate lived inline in SKILL.md. This is only needed when standing up the suite — it adds ~50 lines to every skill read for routine test authoring.

**After:** Moved to `references/setup-and-wiring.md` alongside the wiring gotchas.

### Example: batch-commits edge cases and maintenance section

The batch-commits skill had two inline sections for rarely-needed scenarios: "Edge cases & failure modes" and "Maintaining the tool". The failure modes only matter when something goes wrong; the maintenance section only applies when someone is modifying the tool itself.

**After:** Both moved to separate reference files. Main body now has:
```markdown
## Further Reading
- Getting unexpected output? See [failure-modes.md](./references/failure-modes.md)
- Updating/maintaining the tool? See [maintenance-gotchas.md](./references/maintenance-gotchas.md)
```

---

## Verbosity

Explaining the "why" at length when a single sentence would do. Long rationale blocks, redundant forwarding sentences, and over-qualified caveats all cost reading time without adding guidance.

### Example: multi-paragraph "why" for a one-sentence rule

The skill-creator skill's rule about bundled scripts being self-contained was followed by four sentences explaining the reasoning (portability, host repo dependency risk, what travels with the skill, etc.). The rule itself is clear; the explanation adds bulk without changing what an agent would do.

**Before:**
```markdown
`package.json` and pointing the agent at that command). Have the skill tell the
agent to invoke the script **by its path** instead.

Why: a skill is a portable, droppable unit. The moment running it requires an edit
to the host repo's config, the skill stops being self-contained — it won't work
when the skill is copied to another repo, and it silently breaks if someone changes
or removes that config entry. The script's own directory is the one thing that
always travels with the skill, so depend only on that. If a script genuinely needs
a heavy toolchain, bundle or document that dependency inside the skill rather than
reaching back into the host project for it.
```

**After:**
```markdown
`package.json` and pointing the agent at that command).
```

### Example: redundant forwarding sentence at the end of a section

The showboat skill's "A typical demo" section ended with a sentence pointing ahead to the screenshots section — but the document flows there naturally, and the sentence was confusing in context ("For a **visual** change, the centrepiece is a screenshot instead — see below").

**Before:**
```markdown
Commit the doc under `docs/demos/` and add a **live, clickable link** to it in the PR
description (see *Linking the demo in the PR* below). For a **visual** change, the
centrepiece is a screenshot instead — see below.
```

**After:**
```markdown
Commit the doc under `docs/demos/` and add a **live, clickable link** to it in the PR
description (see *Linking the demo in the PR* below).
```

### Example: verbose batch-commits intro

The original "What it is and why" section of the batch-commits skill devoted two paragraphs to explaining the insight behind the tool (redundant gate runs, why N−1 of them are pure redundancy). The key point is already in the one-line description and the invocation example.

**Before:** Two paragraphs beginning with "Here's the key insight: in the documented flow you **finish the work**…"

**After:** Two sentences: one stating the problem (multiple redundant gate runs), one stating what the script does about it.

---

## Wrong-skill placement

A gotcha recorded in a skill where it won't be read alongside the relevant code. The test: *when would an agent need this information?* Put the gotcha in the skill that covers the work where the problem surfaces.

### Example: Storybook story callback pattern in the RTL skill

The react-testing-library skill had a section explaining how to write Storybook story props (`onOpenChange: () => {}`), including why the `@typescript-eslint/no-empty-function` rule doesn't block it in stories. This is Storybook-authoring knowledge, not test-writing knowledge.

**Before:** "Storybook stories with required callback props" section in `react-testing-library/SKILL.md` (12 lines with code example).

**After:** Removed from RTL skill. The relevant rule context is in the eslint skill; the story-authoring pattern is in the storybook skill. An agent writing RTL tests doesn't need this.

### Example: project-specific ESLint config details in the ESLint skill table

The ESLint skill's quick-reference table had rows for "Allow unused vars/args prefixed with `_`" and "Allow empty stub functions in Storybook stories". These are this project's specific configured choices, not general ESLint patterns — and the details belonged in the config files themselves.

**Before:** Two verbose table rows covering `@typescript-eslint/no-unused-vars` config and `@typescript-eslint/no-empty-function` scope override.

**After:** Both rows removed. The rules are in `frontend/eslint.config.mjs`; agents can read the config directly.
