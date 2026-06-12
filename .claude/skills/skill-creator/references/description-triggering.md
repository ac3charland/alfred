# Writing a description that triggers — the why

This is the reasoning, evidence, and caveats behind the checklist in `SKILL.md`
(§ "Writing a description that triggers"). The checklist there is the *what to do*; read
this when a rule isn't self-evident or you need to make a judgement call.

**The mechanism.** Skills appear in Claude's `available_skills` listing as name +
description only, and the model decides whether to consult a skill from that text. There's
no separate classifier doing anything clever — the description *is* the routing signal. The
rules below are grounded in Anthropic's authoring guidance plus the broader LLM
tool-/skill-selection literature (position-bias studies, tool-retrieval benchmarks, and
independent skill-activation evals).

## Front-load what-it-does and the distinctive keywords

Two forces punish burying the good stuff at the end:

1. **Position bias.** Models lean hardest on the beginning of a block of text (and somewhat
   the end) and "lose the middle" — so the opening words are prime real estate.
2. **Listing truncation.** The available-skills listing is length-capped. In current Claude
   Code each description is shown only up to roughly its first ~250 characters before being
   truncated, so anything after that may never reach the routing decision at all. Treat the
   exact number as a moving target — it's changed before and isn't a documented stable
   contract — but the principle holds whatever the cutoff is.

Practical consequence: the first sentence or two must carry what the skill does *and* its
highest-signal keywords. Don't open with a generic "Use when working in the X package" and
leave the disambiguating vocabulary for a tail that may get cut.

## Triggering rides on literal keyword overlap

In practice, activation behaves closer to keyword matching than to deep semantic
understanding: the skill fires when the user's words overlap the description's words. So
spell out the actual vocabulary a user would type, including near-synonyms and surface
variants — "Docker" *and* "containerized"; the file extension as well as the format name;
"ship it" as well as "deploy". This is why the explicit "Trigger on: …" keyword lists in
several alfred skills earn their keep — just keep the highest-value terms early (per
front-loading, above).

## Disambiguate from sibling skills

The single most common misrouting cause is two skills whose descriptions overlap in scope —
the model picks the wrong one or dithers between them. When two skills could plausibly match
the same request, make their scopes explicitly non-overlapping and say *when to use each*: a
short "do NOT use for X — use the Y skill" where it's genuinely ambiguous, and a positive
"pairs with the Z skill" pointer where they're complementary. This matters more as the
library grows, not less.

## Be pushy to fix under-triggering — but keep scope honest

Claude has a measured tendency to *under*-trigger: to not reach for a skill even when it
would help. That's the dominant failure mode, so make descriptions a little "pushy" — name
the triggering contexts and nudge toward firing even when the user doesn't ask for the skill
by name. For example, instead of just:

> How to build a simple fast dashboard to display internal Anthropic data.

add the explicit pull:

> …Make sure to use this skill whenever the user mentions dashboards, data visualization, or
> internal metrics, or wants to display any kind of company data, even if they don't
> explicitly ask for a "dashboard."

The flip side is real too. An over-broad description carries two costs: false triggers
(firing on adjacent tasks it shouldn't own), and the subtler one — a skill loaded into
context on an irrelevant task can actively *degrade* the result by adding noise and
distraction. So push toward firing, but don't annex territory the skill doesn't cover. When
you optimize the description (see "Description Optimization" in `SKILL.md`), measure both
false negatives *and* false positives, not just whether it triggers.

## Name what the skill *is*, not the action it describes (the verb table)

A skill is something the agent *reads*, not something that *runs* — so the opening verb
should name what the skill **gives** the agent (knowledge, conventions, a procedure, or a
bundled tool), never the downstream action the agent performs after reading it.

**Litmus test:** if the skill were deleted, the verb's claim should turn *false*. "Implements
code against the Claude API" fails it — the agent can still write that code with no skill
present, so the skill plainly doesn't "implement" anything; it's a *reference*, and the
honest lead is "Covers the Claude API: …".

The verb table itself is in `SKILL.md`. The rows aren't rigid — many skills blend two (a
framework reference that also encodes project conventions). Pick the verb for the skill's
center of gravity, keep it third person, and make the very next words the distinctive
keywords.

## Third person, the char cap, and the model

- **Third person about the skill** ("Extracts tables from PDFs and fills forms…"), not first
  person ("I can help you…") or a bare imperative to the user.
- **The `description` field has a hard length cap** (currently ~1024 characters — verify
  rather than trust the number). Spend it on trigger conditions and disambiguation, not
  redundancy.
- **Re-check triggering after any model upgrade.** Selection behavior, and how much a given
  phrasing helps, vary from model to model.
