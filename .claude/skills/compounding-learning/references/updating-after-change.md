# Anti-patterns when a change invalidates skill content

Real before/after examples from this repo's history, for the moment your change —
code, tooling, config, or a decision — makes something a skill currently says false.
Each case is labeled with the anti-pattern, a one-line description of what went
wrong, and the edit that fixed it.

## Contents

- [Meta-comments](#meta-comments) — origin notes, "folded in from", historical context, supersession markers
- [Stale and contradicted content](#stale-and-contradicted-content) — outdated gotchas, retired approaches, sections invalidated by later changes

---

## Meta-comments

Content about how a section got there — origin notes, migration markers, historical
explanations for decisions that are no longer active. None of this helps a future
agent; it only adds noise. The skill must read as if it had always been written with
current knowledge.

### Example: section heading with origin annotation

The supabase skill's security-traps heading revealed how the content was sourced.
Agents don't need to know; only the content matters.

**Before:**

```markdown
### Security traps (folded in from Supabase's first-party skill)
```

**After:**

```markdown
### Security traps
```

### Example: reference-doc intro narrating its own extraction

The playwright setup reference opened by explaining where its content came from.

**Before:**

```markdown
Extracted from the playwright `SKILL.md`. This holds the **one-time setup material
and the gotchas hit wiring the suite up** — …
```

**After:**

```markdown
This holds the **one-time setup material and the gotchas hit wiring the suite up** — …
```

Citing an external source for a factual claim is fine; narrating the edit is not.

### Example: "Historical note" block for a decision that's been reversed

The shadcn skill once contained a full section explaining that `lib/utils.ts` was
renamed to `lib/utilities.ts` and then renamed back. This history is not actionable
— agents just need to know the current name.

**Before:**

```markdown
## `lib/utils.ts` is the standard path — keep it

shadcn/ui's default CLI output creates `lib/utils.ts`...

> Historical note: alfred once renamed this to `lib/utilities.ts` to satisfy
> `unicorn/prevent-abbreviations`... That rule was deliberately disabled
> project-wide... The standard `lib/utils.ts` is back.
```

**After:** section deleted entirely. The fact that `lib/utils.ts` is the standard
path is conveyed by following shadcn defaults — no rule needed.

### Example: blockquote calling out a superseded section

When the storybook skill gained a new Visual Regression section (§7), the agent
didn't remove the old "alfred does not use Chromatic. Visual regression is out of
scope." note in §8. Instead it added a blockquote at the top of §7 explaining that
§8 was now obsolete.

**Before (added to the top of the new §7):**

```markdown
> alfred **does** do visual regression — the §8 note that it "does not" is obsolete.
> The official **Writing Tests → Visual Testing** page documents **Chromatic** only…
```

**After:** blockquote deleted; the old §8 note was rewritten (see the next section).

The fix is always to remove the contradicted content, not to annotate it as
obsolete.

---

## Stale and contradicted content

Content that was once accurate but is no longer true — because the project changed,
or because a new section says the opposite. Delete or rewrite it: a stale statement
left standing makes every future reader adjudicate between two passages.

### Example: contradicted bullet patched by appending a negation

Continuing the storybook case above: the stale §8 bullet was first "fixed" by
stacking the new truth on top of it, producing a sentence that argues with its
former self.

**Before:**

```markdown
- **Chromatic visual diffing**: alfred does **not** use Chromatic specifically (its
  baselines live in the cloud). It **does** do visual regression, self-hosted, with
  baselines committed to git — see §7. Don't reach for Chromatic …
```

**After:**

```markdown
- **Chromatic / `@chromatic-com/storybook`**: alfred does visual regression self-hosted
  with git-committed baselines (§7), so the hosted Chromatic service and its addon are
  intentionally not used.
```

Rewrite the statement so it is simply true.

### Example: gotcha for a rule that was later configured away

The supabase skill documented a workaround for `unicorn/no-null` conflicting with
`.is('column', null)`. When the project disabled that rule (a deliberate config
decision — the config's own comment notes the suggested hack even breaks at
runtime), the entry became misleading: agents following it would write contorted
code for a constraint that no longer exists.

**Before:**

```markdown
- **`.is('column', null)` conflicts with `unicorn/no-null` when the rule has
  `checkArguments: true`.** The Supabase `.is()` type signature is
  `(column: string, value: boolean | null): this` — `null` is mandatory. If the
  project's ESLint config has `unicorn/no-null` with `checkArguments: true` and you
  cannot use `eslint-disable`, use `const DB_NULL = undefined as unknown as null`
  and pass `DB_NULL` instead.
```

**After:** entry removed entirely once `unicorn/no-null` was switched off.

### Example: retired approach kept as a "last resort" appendix

When the `@sparticuz/chromium` fallback was replaced by the custom cloud
environment, the playwright skill kept the dead approach as an option.

**Before:**

```markdown
**Last resort (truly air-gapped CI where the CDN is unreachable at all):**
`@sparticuz/chromium` bundles a serverless Chromium `.br` you `inflate()` to `/tmp`,
point Playwright at via `launchOptions.executablePath` … It's fragile … — prefer the
allowlist approach above. alfred carried this until the custom-environment switch and
no longer needs it.
```

**After:** passage deleted, replaced by two sentences naming the current setup and
linking `docs/cloud-environment.md`. A retired approach left in a skill reads as a
live option and will get re-implemented — "we used to do X" is git's job.

### Example: stale fact left in a neighboring skill

When Chromium provisioning switched from a `/tmp/chromium` extraction to the
Playwright-managed install, the playwright skill was updated — but the showboat
skill kept the old fact, and a later pass had to fix it.

**Before (showboat, stale after the switch):**

```markdown
Reuse the sandbox-aware Chromium the E2E suite installs (`npm run setup:chromium`
extracts it to `/tmp/chromium`) via the `screenshot` helper …
```

**After:**

```markdown
Reuse the Playwright-managed Chromium the E2E suite installs (`npm run setup:chromium`,
which skips the download when the browser is already present) via the `screenshot`
helper …
```

Facts get restated across skills: after an invalidating change, grep
`.claude/skills/` for the old term, path, or name and fix every hit in the same
pass.
