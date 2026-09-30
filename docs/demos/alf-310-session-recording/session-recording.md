---
branch: claude/alf-310-record-session-metrics
---

# ALF-310 — sessions record themselves into the ledger

*2026-09-30T22:20:29.274Z*

Every alfred cloud session now writes its own `code_sessions` row as it runs. A project hook (SessionStart + Stop in `.claude/settings.json`) reads the session's transcripts and posts to `POST /api/code/sessions/record`, which calls `record_code_session`. The transcript has no cost, so alfred prices the tokens itself from `model_price_history`, a dated copy of Anthropic's pricing page that the Worker refreshes on its daily tick.

Everything below runs on invented fixtures and a throwaway local Postgres: the repo is public, so no real session or ledger data appears here.

## 1 · What a stop sends

The hook runs exactly as Claude Code runs it, over the committed transcript fixtures: a main transcript that repeats one API response's usage across several entries, puts a meta entry and a tool result around the prompt, and has a truncated last line, plus one readable Haiku subagent and one it can't read. `--dry-run` prints the body instead of posting it. The prompt is the first message verbatim, skills resolve to blobs at the start commit (the one that doesn't exist there is null), usage is deduplicated per response and split main vs subagents by model, and there is no cost.

```bash
docs/demos/alf-310-session-recording/hook.sh dry-run
```

```output
state file: {"repo":"ac3charland/alfred","base_sha":"839e92dd1c4847cc8f4034b9e8880dc71fd34323","builder_sha":null}
{
  "event": "stop",
  "session_id": "session_01FixtureRecorded",
  "repo": "ac3charland/alfred",
  "session_created_at": "2026-10-03T09:12:40.123Z",
  "prompt": "ALF-310: Create hooks to log session metrics\n\nYou are implementing the ticket ALF-310. Read .claude/skills/implement-spec/SKILL.md first, then .claude/skills/adversarial-review/SKILL.md.",
  "skills": [
    {
      "path": ".claude/skills/implement-spec/SKILL.md",
      "blob_sha": "f491924117d1642d0b376ed983c842c4bf5f885c"
    },
    {
      "path": ".claude/skills/adversarial-review/SKILL.md",
      "blob_sha": null
    }
  ],
  "ref": "ALF-310",
  "model": "claude-opus-5-5",
  "served_model": "claude-opus-5-5",
  "effort_level": "high",
  "input_tokens": 42,
  "output_tokens": 850,
  "cache_read_tokens": 5900,
  "cache_write_tokens": 2400,
  "subagent_count": 2,
  "usage_by_model": {
    "main": {
      "claude-opus-5-5": {
        "requests": 2,
        "input": 30,
        "output": 700,
        "cache_read": 5000,
        "cache_write_5m": 1200,
        "cache_write_1h": 800,
        "web_search": 1
      }
    },
    "subagents": {
      "claude-haiku-4-5-20251001": {
        "requests": 1,
        "input": 12,
        "output": 150,
        "cache_read": 900,
        "cache_write_5m": 400,
        "cache_write_1h": 0,
        "web_search": 0
      }
    }
  },
  "warnings": [
    "subagents_unreadable"
  ]
}
```

## 2 · Silent everywhere else

Without `ALFRED_BASE_URL` (a local session, another environment, a fork of the public repo) the hook does nothing at all: no output, exit 0, nothing written. When alfred refuses a write, the session still sees nothing; one line lands in the hook's own log, with no header or body.

```bash
docs/demos/alf-310-session-recording/hook.sh gate
docs/demos/alf-310-session-recording/hook.sh refused
```

```output
exit 0, output: '', scratch dir: 0 entries
exit 0, output: ''
hook.log:
<time> · stop · session_01FixtureRecorded · 401
```

## 3 · Pricing and ownership in real Postgres

Against a throwaway cluster with every migration applied: the hook records a session before any price is known (`price_unknown`, no cost); the Worker's parser reads the captured pricing page (19 models) and `append_model_prices` stores it, which re-prices the session (`claude-haiku-4-5-20251001` prices as `claude-haiku-4-5`: 0.028872 by hand for this usage); the same table again appends nothing; and a backfill re-run for the session fills the PR fields while the recorded usage, cost, prompt and start commit stay.

```bash
node docs/demos/alf-310-session-recording/prices-and-ownership.mjs
```

```output
1 · the hook recorded the session start and a stop; no prices yet:
  {"prompt_source":"recorded","output_tokens":"850","subagent_count":2,"cost_usd":null,"base_sha":"head-at-session-start","pr_state":null,"launch_lane":null,"warnings":["price_unknown","subagents_unreadable"]}
2 · the Worker's parser read 19 models from the page, e.g.
  claude-opus-5-5  {"name":"Claude Opus 5.5","in":4,"cw5m":5,"cw1h":8,"read":0.2,"out":20}
  claude-haiku-4-5 {"name":"Claude Haiku 4.5","in":1,"cw5m":1.25,"cw1h":2,"read":0.1,"out":5}
  append_model_prices → {"appended":true,"changed":19,"repriced":1}
  the recorded session, re-priced (haiku-4-5-20251001 priced as haiku-4-5):
  {"prompt_source":"recorded","output_tokens":"850","subagent_count":2,"cost_usd":"0.028872","base_sha":"head-at-session-start","pr_state":null,"launch_lane":null,"warnings":["subagents_unreadable"]}
3 · the same table again → {"appended":false,"changed":0,"repriced":0}
4 · a backfill re-run: recorded usage, cost, prompt and start kept; PR fields filled:
  {"prompt_source":"recorded","output_tokens":"850","subagent_count":2,"cost_usd":"0.028872","base_sha":"head-at-session-start","pr_state":"merged","launch_lane":"implementation","warnings":["builder_changed_near_start","subagents_unreadable"]}
```
