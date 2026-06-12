# No archaeology — current truth, no narration

A skill reads as the **current truth**. It is not a changelog, a migration log, or a
record of what an agent just did. Two failure modes live here, and they share a fix —
**delete**:

- **Narrating the edit.** Notes about where text came from or what it replaced
  ("ported from…", "Extracted from…", "folded in from…", "supersedes §8", "Historical
  note: we used to…"). They tell a future reader nothing actionable and cost tokens on
  every load.
- **Leaving contradicted / stale content in place.** When a change invalidates a
  section, the section gets *removed*, not annotated as obsolete. A flag like "the §8
  note is now wrong" leaves both the wrong text and the flag in context.

## Contents

- Supersession note instead of a deletion (storybook)
- Historical "we used to" note (shadcn-ui)
- "Folded in from another skill" porting note (supabase)
- "Extracted from the SKILL.md" reference intro (playwright)
- Stale workaround for a since-removed constraint (supabase)
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

## The constructive counterpart: replace-and-shrink — playwright (`a652f2e`)

Removing stale content doesn't mean losing the lesson. Here the agent deleted two long,
now-wrong setup walkthroughs (the `@sparticuz/chromium` inflate/NSS-stub path) and
replaced them with the lean preferred approach (allowlist `cdn.playwright.dev`),
demoting the old method to a 3-line "last resort." Net effect: **the body shrank
(+43/−96) and stopped contradicting itself.**

**Lesson:** the model edit is replace-and-shrink — supersede old guidance by rewriting
it, not by appending the new truth beside the old.
