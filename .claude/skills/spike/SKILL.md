---
name: spike
description: >
  Describes the spike workflow for answering a research question with a committed findings
  document. Read whenever you're handed a spike: a story titled `Spike: …`, a spike session, or a
  prompt asking for a FINDINGS DOCUMENT ONLY plus a PR carrying `phase: spike`. Trigger on: "run
  the spike", "spike session", "investigate and write up", "findings document", "docs/spikes",
  "phase: spike", or a spike launch prompt. For a spec that describes work to build, use the
  refinement skill instead — a spike answers a question, and its answer may or may not become one.
---

# Spike

> This skill is **dropped into each project repo** at `.claude/skills/spike/SKILL.md`.
> A spike session triggered by our agent orchestrator (alfred) auto-loads it; the launch prompt
> also points here. It's a committed convention so findings are consistent and the orchestrator's
> webhook Worker can rely on the PR shape.

You are in a **spike** session for a research story. Your job is to **find something out and write
down what you found** — not to build it, and not to spec it. One findings document plus a PR is the
entire deliverable.

**Before you investigate:** ground yourself in this repo (skim the structure, read any
`CONTRIBUTING`/`CLAUDE.md`), then check you know what question you're answering. If the story title
and notes don't pin it down, **ask the human first** — they launched this session and are in the
tab, so questions are cheap; findings that answer the wrong question are not.

## What to produce

**One self-contained HTML findings document at `docs/spikes/<REF>-<short-slug>.html`** (e.g.
`docs/spikes/ALF-173-spike-phase.html`). The slug earns its keep because findings are browsed as a
library long after the ticket closes — a bare ref is opaque a year later.

- **One self-contained file:** inline all CSS in a `<style>` block; no build step, no external
  dependencies, no JS required — it opens directly in a browser, and reads well on a phone.
- **Title:** `<title>` and a top `<h1>` of `<REF> — <spike title>`.

Its shape, which is the form this repo's existing findings documents already converged on:

1. **Where we landed** — the recommendation, stated **first**, not buried under the analysis.
   A reader who stops after this section should know what you'd do.
2. **Why** — the evidence that got you there.
3. **Technical shape** — enough concrete detail (interfaces, tables, a diagram, the files it
   touches) for a later spec to expand, without becoming that spec.
4. **Sidebars: appealing alternatives we're not taking** — the options a future reader would
   otherwise re-investigate, and what ruled each out.
5. **Cost & open questions** — effort, money, risk, and what's genuinely still unknown.
6. **Sources** — real links, and the files/commands you actually looked at.

Then **a pull request** whose description carries the machine-readable `alfred` block. `spec-path`
MUST be the findings document you wrote:

````markdown
```alfred
alfred-ticket: <REF>
phase: spike
spec-path: docs/spikes/<REF>-<short-slug>.html
```
````

## Rules

- **Findings must be grounded.** Read the code, run the command, hit the endpoint, check the
  version — record what you actually observed and cite it (file paths, command output, source
  links). A spike that only reasons from memory is the failure mode this skill exists to prevent:
  it reads authoritative and is confidently wrong.
- **No implementation in the PR.** Experiment freely while you work — throwaway branches, scratch
  scripts, a prototype you delete — but the PR contains the findings document and nothing else.
  Don't write a feature spec either: a spike answers a question, and the answer may or may not
  become one.
- **Never archived, never moved.** Findings are long-lived reference material later sessions keep
  reading. Unlike a spec (scaffolding its implementation PR retires into `docs/specs/archive/`),
  a findings document stays exactly where you wrote it, and never goes in the specs directory.
- **One story per spike PR.** Iteration happens in review comments on that PR.
- **The `alfred` block is required** and enforced by the `alfred-frontmatter` check — a PR missing
  it, malforming it, or omitting `spec-path` fails CI. Fix the description if the check is red.
- **Follow-up work is a new story.** A merged spike lands the story at `done`; turning its
  recommendation into a ticket is the human's call, in the board.
- **Say so when it isn't a spike.** If the question is already answered in the repo, or the story
  is really an implementation ticket wearing a `Spike:` prefix, stop and tell the human rather than
  manufacturing findings to fill the document.
