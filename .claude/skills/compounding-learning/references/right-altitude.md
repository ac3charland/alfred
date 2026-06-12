# Right altitude — body vs. reference

The always-loaded SKILL.md body should hold only what's relevant **basically every
time** the skill is used. Setup steps you do once, edge cases you hit rarely, and long
config listings are the wrong altitude for the body — they push the everyday guidance
down and load on every invocation that never needs them. They belong in a `references/`
file, linked from a **table of contents at the top of the body**, so an agent discloses
them only when the situation calls for it.

This is just progressive disclosure (see the skill-creator skill's
`references/example-libraries.md`). The tell that a gotcha is mis-placed: ask "will the
next agent who opens this skill need this *most* times, or only when setting something
up / debugging the harness?" If it's the latter, it's a reference.

## Contents

- One-time config listings sitting in the body (playwright)
- A setup-only error embedded in the body (stryker jest-env)
- A connection-string setup gotcha with trial-and-error in the body (supabase)
- Burying the common case behind a rarely-needed section (playwright ordering)
- Rule substance in the frontmatter description (demo-lint)

## One-time config listings in the body — playwright (`9e7f1ef`)

~90 lines of `playwright.config.ts` + `auth.setup.ts` listings and wiring gotchas sat
in the main body, where everyday test authors scrolled past them every time. Moved
wholesale to `references/setup-and-wiring.md`, replaced by a one-paragraph pointer.

AFTER (what stays in the body):
```
> **Setting up the suite, editing config, or debugging a setup-level failure?** The full
> `playwright.config.ts` / `auth.setup.ts` reference ... live in
> [`references/setup-and-wiring.md`] — pulled out of this skill because they're one-time
> setup, rarely needed for everyday test authoring.
```

**Lesson:** keep a one-line pointer in the body; move the bulk to a reference. The same
commit added a table of contents — the navigational payoff of the split.

## A setup-only error embedded in the body — stryker jest-env (`068bf70`)

A bullet about inline `@jest-environment` pragmas embedded a full multi-line Stryker
error string and exhaustive rationale. It's a per-package *setup* concern hit once, not
every-run guidance — reference material that bloated the always-loaded body.

BEFORE (in the body):
```
Inline `/** @jest-environment node */` pragmas break the run ... `ERROR DryRunExecutor
One or more tests resulted in an error: Missing coverage results for: You probably
configured a test environment in jest that is not reporting code coverage to Stryker` ...
```

**Lesson:** a verbatim error dump for a once-per-package setup step is a reference, not
body text. The body can name the gotcha in a line and link the detail.

## A setup gotcha with trial-and-error in the body — supabase (`d46a947`)

The "direct-connection host is IPv6-only, use the session pooler" item is a
connection-string *setup* concern hit once, but it arrived with a region-prefix
trial-and-error digression in the always-loaded body.

BEFORE (in the body):
```
If you don't know the region, map the project's IPv6 (from `nslookup -type=AAAA
db.<ref>.supabase.co`) against AWS's published `ip-ranges.json`, or just read it off
the dashboard's Session-pooler string.
```

**Lesson:** the skill already linked a `references/` dir — that `nslookup`/`ip-ranges`
detour is exactly what lives there, surfaced only when someone is actually wiring a
connection string.

## Rule substance in the frontmatter description — demo-lint

The frontmatter `description` is the highest tier — the *only* text scanned to decide
whether to load the skill — so it holds what-it-is + when-to-reach-for-it, nothing more.
A new linter's description spelled out each rule's behavior; that substance is body
content (the skill's "The rules" table), not triggering text.

BEFORE (frontmatter):
```
... Two rules ship today: no-root-files (only README.md may sit directly in docs/demos/;
every demo lives in its own folder) and branch-folder (a feature branch must capture its
demo in docs/demos/<current-branch>/, slashes nesting). Use when ...
```
AFTER:
```
... runs in the global check:slow (pre-push). Use when running or interpreting
demo-lint, ... adding or changing one of its rules (no-root-files, branch-folder), ...
```

**Lesson:** name the rules as trigger keywords in the description; let the body explain
what they do. Substance in the description is the same altitude error as a reference-only
detail in the body, one tier up.

## Burying the common case — playwright ordering (`30e0729`)

The rarely-needed "Browser availability / CDN-blocked sandboxes" setup section sat
*ahead of* the everyday "Mocking the backend — integration suite" content. The fix
reordered everyday-first (and trimmed the section's obsolete last-resort detail).

**Lesson:** altitude is about order as well as inclusion. Put what an agent needs most
often at the top; demote setup/edge sections below it.
