# No archaeology — current truth, no narration

A skill reads as the **current truth**. It is not a changelog, a migration log, or a
record of what an agent just did. Two failure modes live here, and they share a fix —
**delete**:

- **Narrating the edit.** Notes about where text came from, what it replaced, or the
  backstory of mistakes that motivated a rule ("ported from…", "Extracted from…",
  "folded in from…", "supersedes §8", "Historical note: we used to…", "this is where it
  repeatedly goes wrong"). They tell a future reader nothing actionable and cost tokens
  on every load.
- **Leaving contradicted / stale content in place.** When a change invalidates a
  section, the section gets *removed*, not annotated as obsolete. A flag like "the §8
  note is now wrong" leaves both the wrong text and the flag in context.

## Contents

- Supersession note instead of a deletion (storybook)
- Historical "we used to" note (shadcn-ui)
- "Folded in from another skill" porting note (supabase)
- "Extracted from the SKILL.md" reference intro (playwright)
- Narrating the problem-history instead of the guidance (CLAUDE.md)
- "Modeled on another tool" provenance (demo-lint)
- Stale workaround for a since-removed constraint (supabase)
- Authoring a skill as a companion to the refactor that spawned it (frontend-architecture)
- Annotating a "left out / not done" entry as now-done (data-flow, supabase)
- "No edit was needed because…" — narrating the wiring just added (backpressure)
- The constructive counterpart: replace-and-shrink (playwright)

## Supersession note instead of a deletion — storybook (`a55ea86`)

A later change established that alfred *does* do visual regression. The agent left the
old claim in place and bolted a blockquote on top explaining it was obsolete.

BEFORE:
```
> alfred **does** do visual regression — the §8 note that it "does not" is obsolete.
> The official **Writing Tests → Visual Testing** page documents **Chromatic** only, a
> hosted service that keeps baselines in the cloud. alfred keeps baselines **in git**, so
> it uses the self-hosted equivalent: the **test-runner's `postVisit` hook** ...
```
AFTER: *(the whole blockquote deleted; the "Where it lives:" content it preceded just
follows directly)*

**Lesson:** if a section is now contradicted, edit the section to be correct (or delete
it). Never leave the wrong version plus a note saying it's wrong.

## Historical "we used to" note — shadcn-ui (`ee25671`)

A whole section narrated a rename that had been reverted — pure archaeology about a
decision that no longer matters.

BEFORE:
```
## `lib/utils.ts` is the standard path — keep it
... Do not rename it.
> Historical note: alfred once renamed this to `lib/utilities.ts` to satisfy
> `unicorn/prevent-abbreviations` ... The standard `lib/utils.ts` is back.
```
AFTER: *(entire section removed)*

**Lesson:** the current state is "it's `lib/utils.ts`," which is also the ecosystem
default — so it needs no skill text at all. The reverted detour is noise.

## "Folded in from another skill" porting note — supabase (`3676ca8`)

BEFORE:
```
### Security traps (folded in from Supabase's first-party skill)
```
AFTER:
```
### Security traps
```

**Lesson:** where content came from is invisible to the reader and irrelevant to the
task. Drop provenance from headings and prose.

## "Extracted from the SKILL.md" reference intro — playwright (`f43a841`)

When content moves into a `references/` file, the intro should describe the *content*,
not announce the move.

BEFORE:
```
Extracted from the playwright `SKILL.md`. This holds the **one-time setup material and
the gotchas hit wiring the suite up** — ...
```
AFTER:
```
This holds the **one-time setup material and the gotchas hit wiring the suite up** —
the `playwright.config.ts` / `auth.setup.ts` reference, ...
```

## Narrating the problem-history instead of the guidance — CLAUDE.md

The CLAUDE.md pointer to the compounding-learning skill explained *why* the skill
exists by recounting where things keep going wrong, rather than just stating what the
skill is for.

BEFORE:
```
Read the `compounding-learning` skill before you do — recording is something we do
consistently, but *how* we record (lean, current, right altitude, no duplication, no
narration of the edit) is where it repeatedly goes wrong, and that skill is the house
style plus a library of before/after examples.
```
AFTER:
```
Read the `compounding-learning` skill before you do — it's the house style for *how*
to record (lean, current, right altitude, no duplication, no narration of the edit),
plus a library of before/after examples.
```

**Lesson:** narration isn't only about *moved* text. Justifying a rule by recounting
the mistakes that led to it ("this is where it repeatedly goes wrong") is the same
archaeology — state what to do, not the backstory.

## "Modeled on another tool" provenance — demo-lint

A new tool's skill introduced the tool by naming the existing tool it was copied from.

BEFORE:
```
`tools/demo-lint` is a small, self-contained TypeScript CLI (modeled on
`tools/skill-lint`) that enforces how `docs/demos/` is organized: ...
```
AFTER:
```
`tools/demo-lint` is a small, self-contained TypeScript CLI that enforces how
`docs/demos/` is organized: ...
```

**Lesson:** how a tool was built ("modeled on…", "mirrors…") is provenance the reader
doesn't need — describe what it *is*, not what it was copied from. The same wording in a
"Maintaining" section ("the architecture mirrors skill-lint") got the same cut.

## Stale workaround for a since-removed constraint — supabase (`3676ca8`)

A gotcha only existed to dodge an ESLint rule the project had since disabled. Once the
rule was gone, the workaround was actively misleading.

BEFORE:
```
- **`.is('column', null)` conflicts with `unicorn/no-null` when the rule has
  `checkArguments: true`.** ... use `const DB_NULL = undefined as unknown as null` ...
```
AFTER: *(bullet removed)*

**Lesson:** gotchas are contingent on live config/infra. When the underlying decision
changes, the gotcha goes with it — sweep it out the same change.

## Authoring a skill as a companion to the refactor that spawned it — frontend-architecture

A new house-style skill, written alongside the refactor PR that motivated it, narrated that PR — the
audit that produced it, the spec that would *introduce* its primitives, that they *may not exist yet*.
A skill is standing current truth; the PR that birthed it is invisible to a future reader.

BEFORE:
```
A five-domain audit found the frontend ... carrying real copy-paste ... The full catalog of primitives
and the phased refactor that introduces the missing ones live in [the spec].
...
Some primitives named below are being **introduced** by the refactor spec and may not exist yet.
```
AFTER:
```
This skill is the standing guidance so frontend work starts aligned instead of adding copied code,
hand-rolled components, or large, un-decomposed components.
...
If the shared layer doesn't already have what you need, add it to the right layer and adopt it
everywhere — don't inline a fresh one-off.
```

**Lesson:** state the convention as if it had always been the rule. Don't anchor a skill to the PR,
audit, or "phased roadmap" that created it, and don't hedge that the primitives it names are still
being rolled out. **And don't call out what doesn't exist** — the first fix traded a migration line
("the former shadcn `ui/` folder was collapsed into `atoms/`") for its present-tense residue ("there
is no `components/ui/`"), but *that's still noise*: a folder the reader will never see doesn't belong
in the skill at all, even to deny it. State only the positive current home — "shared presentational
components live in `components/atoms/`" — and stop.

## Annotating a "left out / not done" entry as now-done — data-flow, supabase

A skill listed realtime under "What's Deliberately Left Out." A later change *built* realtime for
one module, and the agent edited the left-out bullet to say so — leaving a "we don't do X" heading
whose entry then explains X is done.

BEFORE (under `## What's Deliberately Left Out`):
```
- **Realtime / multi-device sync.** Used **only** by the code module: `CodeProvider` subscribes to
  `code_items` Realtime ... idempotent ... Tasks/folders remain seed-once.
```
AFTER: the mechanics move into the **body** as current truth (a "Realtime: the code module's one
push path" section / a pattern-table row), and the list keeps only the still-un-done scope:
```
- **Realtime beyond the code module.** Only `code_items` is subscribed; Tasks/Folders stay
  seed-once, and live cross-device INSERT/DELETE sync is not built.
```

**Lesson:** when something graduates from "left out / not done" to "implemented," **relocate** it to
the body as current truth and trim the left-out entry to the remaining un-done scope. A "not done"
list that describes a done thing is the same self-contradiction as a supersession note — a list of
absences must contain only absences.

## "No edit was needed because…" — narrating the wiring just added (backpressure)

A note about a workspace check explained the *change that added it* — that the wiring needed
no root edit — instead of just stating where the check runs.

BEFORE:
```
A workspace `check:slow` may stand up an external service — the `database` package's
`check:slow` runs the real-Postgres integration suite (it spins a throwaway cluster); no root
edit was needed because the fan-out already runs every workspace's `check:slow`.
```
AFTER:
```
A workspace `check:slow` may stand up an external service — the `database` package's
`check:slow` runs the real-Postgres integration suite (it spins a throwaway cluster).
```

**Lesson:** "no X was needed because…" narrates the diff, not the standing rule. The
surrounding text already states the fan-out runs every workspace's `check:slow`; the current
truth is just that a workspace `check:slow` can stand up a service. State the rule, not what
the change didn't have to touch.

## The constructive counterpart: replace-and-shrink — playwright (`a652f2e`)

Removing stale content doesn't mean losing the lesson. Here the agent deleted two long,
now-wrong setup walkthroughs (the `@sparticuz/chromium` inflate/NSS-stub path) and
replaced them with the lean preferred approach (allowlist `cdn.playwright.dev`),
demoting the old method to a 3-line "last resort." Net effect: **the body shrank
(+43/−96) and stopped contradicting itself.**

**Lesson:** the model edit is replace-and-shrink — supersede old guidance by rewriting
it, not by appending the new truth beside the old.
