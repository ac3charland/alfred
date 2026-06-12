# Recording a new insight — corrections catalog

You're about to add a gotcha or insight to a skill. Calibrate against these
real corrections first: in each, the rejected text was written by an agent
recording an insight and later had to be removed or rewritten by hand.

## Contents

- [What good looks like](#what-good-looks-like)
- [Cut the preamble — open with the specific trigger](#cut-the-preamble--open-with-the-specific-trigger)
- [One clause of why, not a defense brief](#one-clause-of-why-not-a-defense-brief)
- [Don't record hypotheticals or guardrail dodges](#dont-record-hypotheticals-or-guardrail-dodges)
- [Put it in the skill that owns the concern](#put-it-in-the-skill-that-owns-the-concern)
- [Rare-case material goes in a reference, not the body](#rare-case-material-goes-in-a-reference-not-the-body)
- [Tables are for lookup, not paragraphs](#tables-are-for-lookup-not-paragraphs)

## What good looks like

Two unedited entries that needed no correction. The shape: **bolded
symptom-or-rule lead → cause → fix**, a few lines total.

From the showboat skill:

> **Kill the serve before you push.** `serve:storybook` binds port **6006** — the same
> port the pre-push hook's `test:storybook` uses. A background server left running
> makes the hook die with `EADDRINUSE: address already in use 0.0.0.0:6006` and blocks
> the push. After screenshotting, stop it (`pkill -f http-server`) and confirm 6006 is
> free before `git push`.

> **Don't put a triple-backtick fenced code block inside a `note`.** Notes are raw
> markdown, so an embedded fence is reparsed as an `exec` block on the next load —
> it injects a stray empty `output` block, and `verify` will then try to *run* that
> text. Show a command you're only mentioning with **inline** backticks; run a
> command for real with `exec`.

## Cut the preamble — open with the specific trigger

A gotcha in the playwright skill opened with scene-setting before getting to
the point.

Rejected:

> **The `webServer` must be able to boot, or every E2E times out with `Timed out
> waiting Nms from config.webServer`.** In alfred the server is `npm run build && npm
> run start`, and the Supabase client constructor *throws at startup* when …

Corrected — the generic truism ("the server must boot") and the restated
config are gone; the entry opens at the actual trigger:

> The Supabase client constructor *throws at startup* when `NEXT_PUBLIC_SUPABASE_URL` /
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent …

**Principle:** the first words should be the specific condition or symptom,
not a warm-up sentence that's true of every project.

## One clause of why, not a defense brief

The skill-creator skill gained a rule ("bundled scripts must be
self-contained") followed by a nine-line "Why:" paragraph re-arguing it from
first principles — portability, copied repos, config drift, heavy toolchains.

Corrected: the entire "Why:" paragraph was deleted. The rule already made the
reason legible:

> If a skill bundles `scripts/`, they must be runnable **on their own**, straight from
> the skill — `node scripts/foo.mjs`, `python -m scripts.foo`, etc. — without depending
> on anything outside the skill folder.

**Principle:** explain *why* in a clause when it earns its keep; when the rule
is self-explanatory, a paragraph of justification is talking to a reviewer,
not helping the next agent.

## Don't record hypotheticals or guardrail dodges

The supabase skill gained this gotcha:

> **`.is('column', null)` conflicts with `unicorn/no-null` when the rule has
> `checkArguments: true`.** … If the project's ESLint config has `unicorn/no-null` with
> `checkArguments: true` and you cannot use `eslint-disable`, use
> `const DB_NULL = undefined as unknown as null` and pass `DB_NULL` instead. …

Removed wholesale, for two reasons: alfred's config never set
`checkArguments: true`, so the conflict was hypothetical; and the recommended
fix is a type-cast hack to dodge a lint rule — exactly what the back-pressure
rules forbid. The real-world resolution (adjust the rule deliberately, or
file it in `docs/lint-suggestions/`) is the only thing worth recording.

**Principle:** document the project's actual configuration and the *decision*
that resolved the friction — never a workaround that fights the guardrails,
and never advice conditioned on a config this project doesn't have.

## Put it in the skill that owns the concern

The react-testing-library skill gained a long note about Storybook stories
needing no-op callback props ("Stories need inert no-op props for required
callbacks. The project scopes `@typescript-eslint/no-empty-function` **off**
for `**/*.stories.{ts,tsx}` … Don't reach for the old kludge …").

Removed wholesale: it's a Storybook/ESLint concern that happened to be
*discovered* during RTL work. The RTL skill's readers never need it, and the
convention is already enforced by the eslint config.

**Principle:** route by what the insight is about, not where you were standing
when you hit it. If another skill's readers genuinely need it, cross-link
instead of restating.

## Rare-case material goes in a reference, not the body

When a new gotcha only applies while wiring something up for the first time
(installing browsers, scaffolding config) or in another rarely-met scenario,
it does not belong in the SKILL.md body — put it in a `references/<topic>.md`
linked from the skill's Contents section. The worked extractions are in
[structure-and-layout.md](structure-and-layout.md).

**Principle:** the body answers "what do I need every time"; a rare gotcha is
still recorded, just one level deeper.

## Tables are for lookup, not paragraphs

The eslint skill's recipe table (plain-English request → config snippet, one
line per cell) gained rows whose third cell held entire paragraphs:

> | "Allow unused vars/args prefixed with `_`" | A rules block **after**
> `strictTypeChecked` setting `'@typescript-eslint/no-unused-vars'` to `['error',
> { args: 'all', argsIgnorePattern: '^_', … }]` | Project convention in **both**
> packages. `strictTypeChecked` enables … *(a ~120-word cell)* |

Both such rows were deleted: the convention is enforced and visible in the
config itself, and the rows turned a scannable lookup table into walls of
text.

**Principle:** match the form of the entry to its container — a table row
holds a lookup, not an essay. If an insight needs paragraphs, give it a
section or a reference doc. And if the config or gate already teaches it on
contact, it may not need recording at all.
