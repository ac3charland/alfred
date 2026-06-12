# Anti-patterns when recording a new insight

Real before/after examples from this repo's history, for the moment you're adding a
new gotcha or insight to a skill. Each case is labeled with the anti-pattern, a
one-line description of what went wrong, and the edit that fixed it.

## Contents

- [What good looks like](#what-good-looks-like) — two unedited entries that needed no correction
- [Verbosity](#verbosity) — over-explained rationale, scene-setting preambles, redundant forwarding hints
- [Wrong-skill placement](#wrong-skill-placement) — gotchas recorded where they won't be read alongside the relevant work
- [Setup-only gotchas](#setup-only-gotchas) — pointer: these go in `references/`, not the body

---

## What good looks like

The shape to aim for: **bolded symptom-or-rule lead → cause → fix**, a few lines
total. Two entries that needed no correction:

```markdown
**Kill the serve before you push.** `serve:storybook` binds port **6006** — the same
port the pre-push hook's `test:storybook` uses. A background server left running
makes the hook die with `EADDRINUSE: address already in use 0.0.0.0:6006` and blocks
the push. After screenshotting, stop it (`pkill -f http-server`) and confirm 6006 is
free before `git push`.
```

```markdown
**Don't put a triple-backtick fenced code block inside a `note`.** Notes are raw
markdown, so an embedded fence is reparsed as an `exec` block on the next load —
it injects a stray empty `output` block, and `verify` will then try to *run* that
text. Show a command you're only mentioning with **inline** backticks; run a
command for real with `exec`.
```

---

## Verbosity

Explaining the "why" at length when a single sentence would do. Long rationale
blocks, scene-setting preambles, and redundant forwarding sentences all cost reading
time without adding guidance. There is no minimum length for an insight.

### Example: multi-paragraph "why" for a one-sentence rule

The skill-creator skill's rule about bundled scripts being self-contained was
followed by a paragraph re-arguing it from first principles. The rule itself is
clear; the explanation adds bulk without changing what an agent would do.

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

### Example: scene-setting preamble before the actual trigger

The playwright skill's `webServer` gotcha opened with a generic truism (the server
must be able to boot) and a restatement of config before reaching the trigger.

**Before:**

```markdown
**The `webServer` must be able to boot, or every E2E times out with `Timed out
waiting Nms from config.webServer`.** In alfred the server is `npm run build && npm
run start`, and the Supabase client constructor *throws at startup* when …
```

**After:**

```markdown
The Supabase client constructor *throws at startup* when `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent …
```

The first words should be the specific condition or symptom, not a warm-up sentence
that's true of every project.

### Example: redundant forwarding sentence at the end of a section

The showboat skill's "A typical demo" section ended with a sentence pointing ahead
to the screenshots section — but the document flows there naturally, and the
sentence was confusing in context.

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

### Example: verbose intro deriving what one sentence can state

The batch-commits skill's intro spent two paragraphs (beginning "Here's the key
insight: in the documented flow you **finish the work**, get `check` green, then
split the finished diff…") deriving why N−1 of N gate runs are redundant.

**After** — one sentence stating the problem, one stating what the script does:

```markdown
The `pre-commit` hook runs root `check:fast` (typecheck → `eslint --fix` →
`prettier --write` → unit tests) on **every** commit. When committing by logical
concern, this means `check:fast` is run multiple redundant times for the same set
of changes.

This script addresses the problem by running that check **exactly once** and
creating all the commits:
```

---

## Wrong-skill placement

A gotcha recorded in a skill where it won't be read alongside the relevant work. The
test: *when would an agent need this information?* Put it in the skill that covers
the work where the problem surfaces — and if another skill's readers genuinely need
it too, cross-link rather than restate.

### Example: Storybook story callback pattern in the RTL skill

The react-testing-library skill had a section explaining how to write Storybook
story props (`onOpenChange: () => {}`), including why
`@typescript-eslint/no-empty-function` doesn't block it in stories. This is
Storybook-authoring knowledge, not test-writing knowledge.

**Before:** a "Storybook stories with required callback props" section in
`react-testing-library/SKILL.md` (12 lines with code example).

**After:** removed from the RTL skill. The rule context is in the eslint skill; the
story-authoring pattern is in the storybook skill. An agent writing RTL tests
doesn't need it.

### Example: config-documented decisions restated in the ESLint skill table

The ESLint skill's quick-reference table gained rows for "Allow unused vars/args
prefixed with `_`" and "Allow empty stub functions in Storybook stories" —
paragraph-length cells documenting decisions that `frontend/eslint.config.mjs`
already enforces and explains in its own comments.

**Before:** two verbose table rows covering the `@typescript-eslint/no-unused-vars`
options and the `@typescript-eslint/no-empty-function` stories-only override.

**After:** both rows removed. The rules and their rationale live as comments in the
config itself, where agents read them alongside the rules they explain.

---

## Setup-only gotchas

If the new gotcha only fires when standing something up for the first time
(installing browsers, scaffolding config) or in another rarely-met scenario, it
belongs in a `references/<topic>.md` linked from the skill's Contents — not in the
body. Examples are in
[structure-and-layout.md](structure-and-layout.md#setup-only-gotchas-in-the-main-body).
