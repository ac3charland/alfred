---
name: llm-evaluation
description: >
  Covers evaluating Claude Code coding sessions — how models, effort levels, launch prompts and
  subagent setups perform: the code_sessions ledger, experiment design, and seeding the ledger
  with tools/session-ledger. Use when asking which model or effort to default to, what a lane
  costs, or whether a prompt or review change helped. Trigger on: "evaluate models", "model
  performance", "LLM eval", "LLM experiment", "session cost", "effort level", "A/B the prompt",
  "session ledger", "code_sessions", "backfill the ledger". Not for the Worker's LLM features
  (classifier, comms, reader): use their eval:* scripts.
---

# LLM evaluation — measuring coding sessions

## Contents

**This file**

- [The question this answers](#the-question-this-answers)
- [The data: `code_sessions`](#the-data-code_sessions)
- [Pick the instrument for the question](#pick-the-instrument-for-the-question)
- [Reading the numbers honestly](#reading-the-numbers-honestly)
- [Running an experiment](#running-an-experiment)

**Bundled resources**

- **references/**
  - [backfill.md](./references/backfill.md) — the run procedure that (re)seeds `code_sessions`
    from history: collecting session records with subagents, verifying them, `build`, `push`,
    `report`, and every warning code

The evidence, power simulations and sources behind this skill are in the ALF-283 spike,
`docs/spikes/ALF-283-evaluating-coding-sessions.html`. Read it before proposing a new instrument.

## The question this answers

"Should launches default to model X / effort Y / prompt Z / this review setup?" — decided with
evidence from sessions that actually ran, not impressions. Impressions are unreliable: in METR's
randomised trial developers felt 20% faster and measured 19% slower.

## The data: `code_sessions`

One row per Claude Code session that worked on this repo (migration `0048_code_sessions.sql`):

| Columns | What they are |
| --- | --- |
| `configured_model`, `model`, `served_model`, `effort_level` | what was picked, and what actually served the last turn (a fallback shows as a mismatch) |
| `cost_usd`, `*_tokens` | API-equivalent cost and tokens from the session record; whether they include subagents is unconfirmed |
| `launch_lane`, `ref` | which launch prompt started it, inferred from the PR's `alfred` block |
| `pr_state`, `pr_*_at`, `human_commits_after_open` | the outcome: merged or not, and owner rework after the PR opened |
| `prompt`, `prompt_source`, `builder_sha`, `spec_*`, `skills` | the launch prompt, spec and skills as of `base_sha` (main at session start); `builder_sha` groups rows by prompt version |
| `warnings` | why any value above is null — filter on them rather than trusting a null |
| `session_record` | the raw record, so a new metric can be derived in SQL without refetching |

`prompt_source = 'reconstructed'` means rebuilt from history with today's ticket text: treat it as
"very likely", never as observed. Query the live table through `npm run psql -w database -- -c
"<sql>"` (see the supabase skill when Postgres egress is blocked), or run `report` over the NDJSON
a backfill wrote to the scratchpad.

## Pick the instrument for the question

| Question | Instrument | Status |
| --- | --- | --- |
| Effort or model default for a lane | the ledger: cost per lane, rework as the guardrail | ledger exists |
| Did a launch-prompt instruction help | randomised arms by ticket-ref hash in `links.ts`, recorded at launch | needs launch recording |
| Which reviewer model or brief | an offline defect-recall bench (real escaped bugs + surviving Stryker mutants) on `claude plugin eval` | not built |
| Epic orchestration | a structured case review of each epic session | manual |
| A high-stakes model-default change the ledger can't bound | a ticket-replay bench (Harbor) | reserved: costly |

Prefer the cheapest instrument that can resolve the question. Don't score PRs with an LLM judge
when the real outcome (merged, reworked, a fix filed) is free ground truth.

## Reading the numbers honestly

- **Compare within a lane.** Lanes differ several-fold in cost; a pooled comparison measures the lane mix.
- **History is observational.** The model was chosen per ticket, so a model's past cost is a prior,
  not a result. Only randomised assignment licenses "X is cheaper".
- **Cost is the tail.** Report median and p90 (the `report` command does), and look at outliers
  individually: one session has cost 45× the median.
- **Small n.** About 45 implementation launches a month: a halving of cost shows up in ~2 months;
  a 20-point quality gap needs ~80 sessions per arm. So the working decision rule is cost-first
  non-inferiority — adopt the cheaper arm unless a guardrail (rework, red CI, escaped bugs) trips.
- **Put an interval on every rate** (Wilson for proportions) and use paired tests when two arms
  answer the same items.
- **Include no-PR sessions.** About a third of sessions never open a PR; a PR-only view is survivorship.
- **Review findings are not reviewer value.** A reviewer asked to find gaps reports some; value is
  recall on known bugs and precision on findings you agree with.

## Running an experiment

1. Write the question, the arms, the primary outcome (merged without rework) and the decision rule
   **before** looking at any data.
2. Assign arms by a stable hash of the ticket ref, never by choice, and record the assignment.
3. Analyse by the assigned arm (intention to treat), within lane, with intervals.
4. Read a sample of transcripts from each arm: the numbers say where to look, not why.
