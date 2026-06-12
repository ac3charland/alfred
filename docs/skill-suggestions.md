# Skill-library suggestions

Structural / architectural ideas for the `.claude/skills/` library that go beyond a
single description rewrite. These came out of auditing every skill against the research
report *"Writing Descriptions for SKILL.md and LLM Tool/Skill Routing: An Evidence-Graded
Guide"* (uploaded 2026-06-12).

Per the task that produced this file, I **only edited descriptions** in the audit — no
skill was deleted or consolidated. Everything below is a recommendation for a separate,
deliberate decision. Each item notes the evidence behind it and a concrete next step.

---

## What was already changed in the audit (for context)

So this doc is self-contained about what's a *suggestion* vs. *done*:

1. **`skill-creator` SKILL.md** gained a new **"Writing a description that triggers"**
   subsection (front-loading, keyword/lexical overlap, sibling disambiguation,
   pushiness-vs-false-positives, third person / char cap / re-test-after-model-upgrade)
   and a **discovery-ceiling / retrieval-at-scale** note in the Description Optimization
   section.
2. **Sibling disambiguation clauses** ("do NOT use for X — use the Y skill") were appended
   to the genuinely-overlapping clusters: `react` / `react-testing-library` / `jest`,
   `tailwindcss` / `shadcn-ui` (with a pointer to `motion`), `playwright` / `storybook`,
   `anthropic-api` → `cloudflare-workers`, and `skill-creator` ↔ `lib-skill-forge`.
3. **Every description was rewritten to lead with what-the-skill-does** — a third-person verb
   (Covers / Configures / Owns / Drives / Builds / Implements) plus the distinctive keywords —
   instead of a generic `Use when working in the X package…` opener, so the highest-signal
   words land at the front (this was item 2 below; now done).

The items below are structural changes I deliberately did **not** make, because they alter
the library's shape rather than the wording of individual descriptions.

---

## 1. The library has likely crossed the "discovery ceiling" (highest priority)

**Evidence.** The report's single most concrete mechanical finding: the `available_skills`
listing the model sees at selection time is length-capped (the cited analysis puts it at
~1% of the context window, ≈8,000 characters, ~32 average skills before truncation; and
separately reports each description truncated to ~250 chars in the listing). Past that
point, "descriptions are silently shortened and triggering degrades" — not because any one
description is bad, but because they no longer all fit.

**Our numbers (measured post-audit).** 22 skills, **~13,800 characters** of description
text total — already ~1.7× the ~8,000-char budget the report cites. Average description
is ~630 chars; **none** fits in the cited ~250-char per-skill listing window. The
what-it-does lead + distinctive keywords now sit in the front (good — see item 2), but the
trailing keyword catalogs and the sibling-disambiguation pointers ("use the Y skill") still
fall in the *tail* of the longer descriptions — past the likely visible window, so they may
not reach the routing decision at all.

> ⚠️ Treat the exact thresholds as uncertain. The report explicitly flags these character
> limits as a moving target ("verify current limits in the docs before relying on exact
> numbers"). But the *direction* — more, longer descriptions ⇒ worse triggering — is
> robust (HumanMCP: 87.4% → 65% as the pool grew; "Lost in the Middle" position bias).

**Options, roughly in order of effort:**

- **(a) Tighten descriptions so the essentials fit the visible window.** The *what it does +
  top keywords* half of this is **done** (item 2); the remaining step is to get the
  *disambiguation pointers* inside the first ~250 chars too — either by moving them earlier
  or by trimming the exhaustive keyword catalogs that currently push them into the tail.
  Lowest-risk, keeps the flat structure.
- **(b) Consolidate overlapping clusters** into fewer skills with `references/` files (see
  item 3). Fewer top-level descriptions ⇒ more budget per skill ⇒ less truncation. This is
  the report's recommended structure (progressive disclosure) and *also* removes routing
  ambiguity — two wins from one move. Costs: bigger refactor; the user asked to hold off on
  consolidation for now.
- **(c) Move to retrieval / tool-search.** Embed descriptions and retrieve a top-k subset
  per query instead of loading all of them (RAG-MCP: 13.62% → 43.13% in the report). This
  is the real fix once a pool is "a few dozen+", but it adds latency and a
  retrieval-miss failure mode, and depends on harness support we don't obviously control
  from this repo. Probably premature at 22 skills; revisit if the count keeps climbing.

**Recommendation:** Do **(a)** now (cheap, reversible), keep **(b)** on the table as the
library grows, and only reach for **(c)** if we blow well past ~32 skills.

---

## 2. Front-load distinctive keywords ahead of generic scope leads — DONE

**Evidence.** Position bias ("Lost in the Middle" — start/end used best, middle lost) plus
the listing truncation above mean the first words are prime real estate. The report's #1
recommendation is to lead with *what it does + the literal keywords a user would type*.

**Status: applied to all 22 skills.** Originally 20 of 22 descriptions led with a generic
`Use when working in the X package…` opener and buried their distinctive vocabulary in the
tail. Each was rewritten to open with a third-person what-it-does clause carrying the domain
keyword at word ~2 — e.g. `cloudflare-workers` now opens "Covers Cloudflare Workers
development in the alfred workers/ package… ctx.waitUntil, wrangler deploy…" rather than
"Use when working on any file…", and `react` / `nextjs` / `supabase` lead with "Covers React
function-component and hooks patterns…", "Covers Next.js App Router development…", and
"Covers Supabase in the alfred project…". `lib-skill-forge` and `skill-creator` already led
with what-they-do and were left as-is.

**Still open (folds into item 1a):** the *disambiguation pointers* still sit in the tail of
the longer descriptions. And per the report, this kind of reordering should ideally be
**measured** rather than trusted by feel (item 4) — confirm the front-loading actually lifts
triggering for our model rather than assuming it does.

---

## 3. Overlapping clusters worth considering for consolidation

The report names overlapping scope as the **top misrouting cause**. I added
"when-to-use-each" disambiguation as a band-aid, but the cleaner long-term fix for the
tightest clusters is one skill with `references/` sub-files (progressive disclosure), which
also helps the ceiling (item 1). Candidates, with the trade-off:

| Cluster | Overlap | Case for merging | Case for keeping separate |
|---|---|---|---|
| `jest` + `react-testing-library` + `storybook` | all "frontend testing"; "interaction test" / `*.test.ts` ambiguity | one `frontend-testing` skill, fewer descriptions, no routing dither | genuinely distinct tools/APIs; each is already focused |
| `tailwindcss` + `shadcn-ui` + `motion` | all frontend styling; `@theme` tokens appear in all three | one `styling` skill routing to per-tool refs | clear tool boundaries; `motion` owns a specific token system |
| `eslint` + `commitlint` | both "repo tooling / hooks / config"; husky overlap | one `repo-tooling` / lint-and-format skill | distinct configs and trigger vocab |
| `lib-skill-forge` vs `skill-creator` | both match "create a skill" | `lib-skill-forge` could be a `references/` mode of `skill-creator` | different enough workflows; I added reciprocal pointers instead |

**Recommendation:** If we act on the ceiling via consolidation, start with the
**testing trio** — it has the sharpest "interaction test" ambiguity and the clearest shared
home. Each merge should keep the per-tool depth in `references/` so nothing is lost.

---

## 4. Measure triggering instead of hand-tuning it (and re-measure after model upgrades)

**Evidence.** The report is emphatic that *clarity-to-humans ≠ triggering*, that activation
behaves "closer to keyword matching than semantic matching," and that behavior **varies by
model** (Spence: ~80% on Haiku 4.5 → 100% on Sonnet 4.5). It recommends an eval set of 20+
realistic should-trigger / should-not-trigger queries, run ~3× each, 40% held out, tracking
**both** false negatives and false positives.

We already own the machinery: `skill-creator`'s `scripts/run_loop.py` does exactly this
optimization loop. Two suggestions:

- **Run it against the real session model** for the handful of skills most prone to
  mis-routing (the clusters in item 3) before doing the item-2 reordering by feel. Let data,
  not intuition, drive the rewrite.
- **Add a lightweight project-level triggering regression** — a small fixture of
  "this prompt should pull skill X" cases — and re-run it after each model bump, since the
  report warns triggering behavior shifts across models. This is the skills analogue of the
  back-pressure suites in `CLAUDE.md`.

---

## 5. Minor: standardize the opening phrase

Descriptions vary between "Use when…", "Use this skill whenever…", "Use this skill when…",
"Build a…", and "Create…". The report notes consistent naming/phrasing patterns carry a
small independent signal and reduce ambiguity. Low priority, but if we do the item-2 pass,
standardizing on one opener (e.g. "Use when …") is a free cleanup. (`name` fields are
already consistently lowercase-hyphen with no numeric-suffix near-duplicates — good.)

---

### Pointer

The "how to write a triggering description" guidance from the report now lives in
`.claude/skills/skill-creator/SKILL.md` → **"Writing a description that triggers"** and the
discovery-ceiling note in its **Description Optimization** section. Use those when authoring
new skills; use this file when deciding whether to restructure the library.
