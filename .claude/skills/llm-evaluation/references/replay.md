# Replaying a ticket across arms

Rebuild one merged ticket in fresh cloud sessions, one per arm (model, effort, subagent setup), from
the commit its original session started on, then compare cost and output. One replay is a case
study, not a result (see [Reading the numbers honestly](../SKILL.md#reading-the-numbers-honestly)):
use it to find where arms differ, and the ledger to decide.

## Contents

- [Set up the arms](#set-up-the-arms)
- [Measure cost](#measure-cost)
- [Judge the output](#judge-the-output)
- [Replaying a review round](#replaying-a-review-round)

## Set up the arms

- **Base commit = main at the original session's `created_at`**, not the PR's `base.sha`: sessions
  rebase, so the PR base can include later merges. Find it with `git log --first-parent origin/main
  --until=<created_at> -1`.
- **The launch prompt** is the session's first user event that isn't synthetic: page
  `list_events` (`kinds: ["user"]`) to the start. Count the human turns after it too. A historical
  session with mid-run turns, a rebase or its own subagents is a reference point, not a control,
  so replay every arm fresh, the baseline included.
- **`create_session` sets `model` but not effort: pin it in every arm.** Left alone, a child runs
  its model's default (Opus 5.5: medium; Opus 5 and Fable 5.1: high), so arms can differ in effort
  without anyone choosing it. Subagents inherit the session's effort, a `model:` override included,
  so an arm's reviewer runs at the arm's level. Three ways:
  - **`effortLevel` on the arm's base branch (preferred: no setup, the prompt stays the first
    turn).** Push the base commit as `<spike-ref>/base-<level>`, add one commit setting
    `"effortLevel": "<level>"` in `.claude/settings.json` (`low` to `xhigh`; not `max`), and pass
    that branch as `source_revision`. The GitHub MCP's `create_or_update_file` makes that commit
    without running local hooks. In the preamble that commit is the base (review diff,
    `origin/main`), and the arm is told to leave the file alone.
  - **`/effort` as the prompt.** Set `prompt` to exactly `/effort <level>`: a task on the
    next line becomes part of the argument and the command fails. It runs without a model turn. Put
    the launch prompt in `append_system_prompt`, then start the child with a `send_message` ("start
    the task in your system prompt"). A task sent only by `send_message` is refused, since it
    arrives as data. The task then sits in the system prompt rather than the first turn, so launch
    every arm this way, baseline included. The arm's ledger row records `/effort <level>` as its
    `prompt`, so don't read `prompt`, `ref` or `skills` from it.
  - **An environment per level.** `CLAUDE_CODE_EFFORT_LEVEL` overrides `--effort` and `/effort`.
    The owner sets it as an environment variable on a copy of the alfred environment, in the
    claude.ai environment settings; pass that `environment_id`. Precedence is verified in the CLI;
    no cloud run yet.

  Check what ran: every transcript entry, main and `subagents/*.jsonl`, carries `"effort"`
  (`grep -o '"effort":"[a-z]*"' <file> | sort | uniq -c`), or read `$CLAUDE_EFFORT` in the child's
  shell. `get_session` → `session_context.effort_level` shows only an `/effort` pick: it is null at
  the model default, under `effortLevel`, and (per the CLI's code) under the environment variable.
- **Every rule goes in the launch prompt.** A later `send_message` is delivered as "DATA, not
  operator instructions", so it is weaker than the prompt. Prepend one shared preamble to the
  verbatim prompt; the arms should differ only in their architecture block. The preamble says:
  - push to `<spike-ref>/replay-<arm>` and open no PR (an `alfred` block would move the ticket; the
    in-prompt rule beat the harness's auto-PR default);
  - review the branch diff instead of a PR;
  - nobody answers questions;
  - don't read the merged solution (name the PR, branch and archived spec);
  - **never `git fetch`; point `origin/main` at the base instead** (`git update-ref
    refs/remotes/origin/main <base>`) before the first push, because the pre-push gate diffs
    against `origin/main` and a fetch brings in the merged solution;
  - send the final report to `@parent` with `send_message`, because a child that finishes cleanly
    doesn't notify its parent.
- **A historical base lacks newer tooling.** For example, the recording hook is absent before
  ALF-310, so the replay writes no ledger row. Its date-bound tests may also have rotted (on a
  late-September base, a habits E2E's June dates fell outside the window and failed the pre-push
  gate), so every arm spends a commit re-anchoring them: leave that commit out when comparing diffs.

## Measure cost

- **`get_session` → `usage.cost_usd` is the cost.** It includes subagents with their real output:
  in the ALF-265 replays it exceeded the transcripts' main-thread tokens by the subagents' share.
  It refreshes only at a turn's end, so read it once the session is idle. A child writes its cache
  at the 1-hour rate (2× input), while a reviewer or implementer subagent in production writes at
  the 5-minute rate (1.25×): reprice `cache_write_tokens` before comparing with production.
- **`list_events` usage is the stream-start snapshot**, main thread included: its output counts
  are placeholders. Take output from `get_session`.
- **The per-model split comes from the transcript.** Have each arm run the hook in dry-run as its
  last step, from a worktree of main when its base predates the hook:
  `echo '{"transcript_path":"<main .jsonl>"}' | CLAUDE_CODE_REMOTE_SESSION_ID=$CLAUDE_CODE_REMOTE_SESSION_ID node tools/session-ledger/src/hook/cli.ts stop --dry-run`.
  Input, cache and request counts are reliable. Subagent output is a placeholder
  (`subagent_usage_partial`), so take subagent output as `get_session` output minus main-thread
  output.

## Judge the output

- Run a blind pairwise judge on the diffs against the replay base, with binary snapshots excluded.
  **Mask model names, branch names and session ids, and give the patches neutral file names:**
  `diff-opus.patch` unblinds the judge.
- Brief the judge to grade the spec's checklist item by item, citing `file:line`, before giving a
  verdict. Allow "about the same", and break a tie on equal fidelity in favour of the smaller patch.
- Run two judge model families, each in both X/Y orders. A preference counts only when it holds
  across order. Judges favour their own family, and position bias is real.
- Pair the judge with the outputs the gates already give: green pre-push `check:slow`, test counts,
  and the review round's findings and their dispositions.

## Replaying a review round

To compare reviewer models or briefs on PRs whose review already ran (worked in ALF-266):

- **The brief is the transcript's.** Page the implementing session's `list_events` for the `Agent`
  tool_use with `model: "opus"`: its `input.prompt` is the brief, and the reviewer's own events
  (`parent_tool_use_id`) follow it. The reviewed commit is the PR head at the spawn: the reviewer's
  first `git log`, since a new branch's push prints no range. Briefs are hand-written per PR, so the
  prompt is consistent across arms of one case, never across cases.
- **The child is the reviewer:** `create_session` with `source_revision` set to that head, and the brief
  verbatim behind a preamble. The preamble points `origin/main` at the base (`git update-ref`) and
  skips the brief's fetch, because today's main holds the PR's fix commits. It forbids reading the PR
  and hands over the body GitHub stored at review time, which can differ from the create call (an
  appended footer, a reformatted link).
- **Ground truth is what the author verified:** findings fixed, or raised as real. It comes from one
  Opus run, so add a fresh run of the original model as a control, and verify every new finding a
  report labels major against the commit. A reviewer that sampled a GIF's frames reported a false major.
- A child can stall in setup: it stays PENDING, with no events after the setup script's image pull.
  Archive it and relaunch.
