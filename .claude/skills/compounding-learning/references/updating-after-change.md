# Updating skills after a change — corrections catalog

Your change — code, tooling, config, or a decision — makes something a skill
currently says false. These corrections show the house style: the library must
always read as if it were written fresh against the current repo.

## Contents

- [Rewrite the contradicted text — never annotate it](#rewrite-the-contradicted-text--never-annotate-it)
- [Don't append the correction beside the old claim](#dont-append-the-correction-beside-the-old-claim)
- [No provenance or changelog narration](#no-provenance-or-changelog-narration)
- [Retired approaches vanish — no historical notes](#retired-approaches-vanish--no-historical-notes)
- [When the cause is gone, the warning goes too](#when-the-cause-is-gone-the-warning-goes-too)
- [Sweep every skill that mentions the changed thing](#sweep-every-skill-that-mentions-the-changed-thing)

## Rewrite the contradicted text — never annotate it

When visual regression testing was added, the storybook skill elsewhere said
"alfred does not use Chromatic. Visual regression is out of scope." The agent
adding the new section left that claim standing and opened the new section
with a meta-note about it instead:

Rejected:

> > alfred **does** do visual regression — the §8 note that it "does not" is obsolete.
> > The official **Writing Tests → Visual Testing** page documents **Chromatic** only, …

Corrected: the blockquote was deleted outright; §8 itself was rewritten to be
true.

**Principle:** fix the stale statement at its source. A note telling the
reader which *other* part of the document is wrong leaves two contradicting
passages and makes every future reader adjudicate between them.

## Don't append the correction beside the old claim

Same event, second failure mode: the stale bullet was "fixed" by stacking a
negation on top of it.

Rejected:

> - **Chromatic visual diffing**: alfred does **not** use Chromatic specifically (its
>   baselines live in the cloud). It **does** do visual regression, self-hosted, with
>   baselines committed to git — see §7. Don't reach for Chromatic …

Corrected — rewritten as one true statement:

> - **Chromatic / `@chromatic-com/storybook`**: alfred does visual regression self-hosted
>   with git-committed baselines (§7), so the hosted Chromatic service and its addon are
>   intentionally not used.

**Principle:** a patched sentence reads like an argument with its former self.
Rewrite the statement so it is simply true.

## No provenance or changelog narration

A section header in the supabase skill:

Rejected:

> ### Security traps (folded in from Supabase's first-party skill)

Corrected:

> ### Security traps

The intro of a playwright reference doc:

Rejected:

> Extracted from the playwright `SKILL.md`. This holds the **one-time setup material
> and the gotchas hit wiring the suite up** — …

Corrected — same sentence minus the narration:

> This holds the **one-time setup material and the gotchas hit wiring the suite up** — …

**Principle:** where content came from — another skill, a previous section, an
upstream doc — is meaningless to the next reader. Describe what the content
*is*, not what was done to produce it. (Citing an external source for a
factual claim is fine; narrating the edit is not.)

## Retired approaches vanish — no historical notes

When the `@sparticuz/chromium` fallback was replaced by the custom cloud
environment, the playwright skill kept the old approach as an appendix:

Rejected (excerpt):

> **Last resort (truly air-gapped CI where the CDN is unreachable at all):**
> `@sparticuz/chromium` bundles a serverless Chromium `.br` you `inflate()` to `/tmp`,
> point Playwright at via `launchOptions.executablePath` … It's fragile … — prefer the
> allowlist approach above. alfred carried this until the custom-environment switch and
> no longer needs it.

Corrected: the whole passage deleted, replaced by two sentences naming the
current setup and linking `docs/cloud-environment.md`.

**Principle:** "we used to do X" is the changelog's job, and git already keeps
it. A retired approach left in a skill reads as a live option and will get
re-implemented.

## When the cause is gone, the warning goes too

After `unicorn/prevent-abbreviations` was disabled project-wide, the shadcn-ui
skill still carried a whole section defending `lib/utils.ts` against a rename,
ending in:

Rejected (excerpt):

> > Historical note: alfred once renamed this to `lib/utilities.ts` to satisfy
> > `unicorn/prevent-abbreviations` … That rule was deliberately disabled project-wide …
> > The standard `lib/utils.ts` is back. See the eslint skill for the rule decision.

Corrected: the entire section removed — not just the historical note. With the
rule disabled, nothing pushes anyone toward the rename, so the warning guarded
against a ghost (and the rule decision was already recorded in the eslint
skill).

**Principle:** when the force that created a gotcha is removed, delete the
gotcha — don't soften it into a history lesson.

## Sweep every skill that mentions the changed thing

When Chromium provisioning switched from a `/tmp/chromium` extraction to the
Playwright-managed install, the playwright skill was updated — but the
showboat skill still carried the old fact, and a later pass had to fix it:

Rejected (stale after the switch):

> Reuse the sandbox-aware Chromium the E2E suite installs (`npm run setup:chromium`
> extracts it to `/tmp/chromium`) via the `screenshot` helper …

Corrected:

> Reuse the Playwright-managed Chromium the E2E suite installs (`npm run setup:chromium`,
> which skips the download when the browser is already present) via the `screenshot`
> helper …

**Principle:** facts get restated across skills. After an invalidating change,
grep `.claude/skills/` for the old term, path, or name and fix every hit in
the same pass — a stale mention in a neighboring skill misleads just as much.
