---
name: refinement
description: >
  Describes the refinement workflow for turning a code ticket into a spec. 
  Read whenever you're handed a ticket to refine into a spec: a refinement
  session, or a prompt asking for a SPEC ONLY plus a spec-carrying PR. Trigger on: "refine the
  ticket", "refinement session", "write the spec for", "spec-only PR", "refinement PR", or a
  refinement launch prompt.
---

# Refinement

> This skill is **dropped into each project repo** as the whole `.claude/skills/refinement/`
> folder (`SKILL.md` + `assets/`).
> A refinement session triggered by our agent orchestrator (alfred) auto-loads it; the launch prompt also points here. 
> It's a committed convention so refinement output is consistent and the orchestrator's webhook Worker can rely on the PR shape.

You are in a **refinement** session for a story. Your job is to **write a spec** — **not to
implement anything**. Produce one spec artifact and open a PR; that is the entire deliverable.

**Before you write anything:** ground yourself in this repo (skim the structure and read any
`CONTRIBUTING`/`CLAUDE.md`), then decide whether you actually have enough to spec. If the story
title + notes don't pin down the scope and acceptance criteria, **ask the human first** — they
launched this session and are in the tab, so questions are cheap; an invented spec is not. Only
once the scope is clear do you write the spec below.

## Contents

- [What to produce](#what-to-produce)
- [Rules](#rules)
- **assets/**
  - [spec-template.html](./assets/spec-template.html) — the spec scaffold: the fold, section ids
    and order, each section's budget, and the house stylesheet

## What to produce

1. **A spec at `docs/specs/<REF>.html`, copied from [`assets/spec-template.html`](./assets/spec-template.html)**
   — HTML, not markdown. Two readers, split at a fold:
   - **Above the fold (`#brief`): only what the human needs to approve** — the change in one
     sentence, the decisions they must see, and a picture of everything they'll see; ≤ 300 words of
     prose (epic 450), pictures uncounted. **Below (`#detail`): everything the implementer
     needs.** Keep the template's ids, order, budgets and stylesheet; delete an unused optional
     section rather than writing "None", and strip every `guide:` comment.
   - **A decision reaches the brief only if the human would see its result, it's costly to
     reverse, or it departs from the ticket, the epic or a prior spec** — every other call is
     recorded below only. Mark each row `open` (needs their pick — a taste call, not a check you
     skipped), `proposed` (your call; merging accepts it) or `settled` (they decided). Over 7 rows
     (epic 12) means split the spec. No `open` row survives merge: if the human approves with one
     open, say so in your PR reply.
   - **Each fact lives once.** The brief states the pick; the detail explains it by id (`D2`,
     `P1`) and never contradicts it — on conflict the brief wins. Trace every acceptance
     criterion to the row or plate it realizes, or `impl`: a visible behaviour tracing to nothing
     above was never signed off — promote it or cut it.
   - **Reads with scripting off.** alfred's spec view is a script-less sandbox, so plates and
     switchers are static markup + CSS; inline `<script>` only as enhancement.
   - **Mockups are drawn in the app's design system** — not default browser styling, and not the
     document's own palette or an older spec's stylesheet. A mockup in another visual language
     reads as a different product: it asks the human to sign off on a surface that will never
     ship, and misleads the session that builds it. Scope the app's real tokens as CSS custom
     properties on the mockup container — the surrounding prose keeps the document's own light/dark
     chrome — and take every value from source rather than memory: colours, radii and fonts from
     the app's global stylesheet (`frontend/app/globals.css`), each component's treatment from the
     atom that renders it (lookalikes diverge — a popover's surface is not a dropdown menu's),
     feature geometry from that feature's `*.styles.ts`. Restyle what's nested inside the canvas
     too, inline `<code>` above all, or it flashes document styling onto the app's. It's the visual
     language that has to match, not the pixels — and drawing it faithfully audits the design:
     it's what catches a mockup depicting an arrangement the real component can't produce.
   - **Make the mockup interactive when one static frame can't carry the decision — your call;
     don't wait to be asked.** Do it when the story implies a visual change without pinning the
     direction ("somehow distinguish X"), when more than one treatment is credible, or when the
     behavior spans states one frame can't show (hover, select mode, empty/loading, narrow
     viewport, output that depends on time or input). Draw every option/state and add one
     switcher per plate, labelled with the decision it settles (`D2: A | B`) — radio inputs, CSS
     selecting on `:has(:checked)` so it works without script — so the human compares them in
     place and picks one. Rest the recommended option's radio checked, so the plate opens on it,
     and keep the switcher in the document's chrome, outside the canvas, so it isn't read as
     product UI. Ask up front only when the direction hinges on taste you can't infer from the
     ticket or the app. Skip it for non-UI stories and single-state changes the ticket already
     pins.
   - **Never pin a sequence-allocated number** — a **migration number** above all. Other work
     merges while the spec waits, so the number you pick is stale by the time it's built: write
     "the next available migration number" / `<next>_<name>.sql` and let the implementation
     session take whatever is free.

2. **A pull request** whose description carries the machine-readable `alfred` block so the Worker
   can advance the ticket. The `spec-path` MUST match the file you created:

   ````markdown
   ```alfred
   alfred-ticket: <REF>
   phase: refinement
   spec-path: docs/specs/<REF>.html
   ```
   ````

## Rules

- **No implementation.** No app/source changes in a refinement PR — only the spec file (and, if
  needed, supporting docs). Implementation happens later, in a separate session, after this PR merges.
- **One story per refinement PR**, unless explicitly told to batch (then list every ref in
  `alfred-ticket`, comma-separated).
- **The `alfred` block is required** and is enforced by the `alfred-frontmatter` check — a PR
  missing or malforming it (or omitting `spec-path` on a refinement PR) fails CI. Fix the
  description if the check is red.
- **Ask when context is thin.** If the title + notes don't pin down scope or acceptance, ask the
  human in this session *before* writing the spec — don't guess. Putting a guess in the spec just
  defers the error to the implementation session.
- **A visual requirement the mockup doesn't draw isn't settled.** The human signs off on the
  picture, not the prose beside it — a cue, glyph or state that exists only in a prose table was
  never agreed to, and building it ships something they've never seen and will read as invented.
  So before a UI section is done, take every sentence that changes what appears on screen and find
  it in the mockup: draw it or cut it — a genuine taste call becomes an `open` row with each option
  drawn in its plate's switcher. (Prose the picture can't carry —
  API contracts, arithmetic, validation — needs no drawing; the test is whether the human would
  *see* it.) Three ways this slips: alternatives you offer them to pick between must each carry
  the requirements already written, because the pick **is** the sign-off; the **legend is part of
  the mockup**, so reconcile it against the state list it explains; and a *"behaviour and layout
  intent, not a pixel spec"* caveat licenses departures in **fidelity** — padding, radius, hover —
  never in **presence**.
- **Not a clean one-story spec? Say so.** If the story is too big for a single spec, isn't
  actually a story (a question, a bug report, a duplicate of existing behavior), or can't be
  scoped from what you have, stop and tell the human — propose a split or a next step instead of
  forcing a spec to exist.
- **Spec demo/acceptance evidence must match showboat's rules — cross-reference, don't
  restate.** When the spec pins the demo or verification evidence for a user-visible change,
  follow the `showboat` skill's evidence-matching rather than inventing your own. Point it at the showboat rules and let those stay the source of truth.
- **Iterate via PR comments, answered by id** (`D2: B`). Fold each answer back in the same round:
  flip its row to `settled` and rewrite the pick, update its `#dN` record to match (the state in its
  heading, the chosen option up, the rest one "considered" line), re-rest its plate on the chosen
  option and drop the losers, sweep the behaviour and criteria that hung on the old pick, and
  replace `#revised`.
- **Don't proactively schedule a check-in on the PR.** CLAUDE.md's "No scheduled
  check-ins" rule applies here — once the spec PR is open, respond to CI failures or
  comments that reach you, but don't poll for them on a timer.
