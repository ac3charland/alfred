# Replaying a ticket across arms

Rebuild one merged ticket in fresh cloud sessions, one per arm (model, effort, subagent setup), from
the commit its original session started on, then compare cost and output. One replay is a case
study, not a result (see [Reading the numbers honestly](../SKILL.md#reading-the-numbers-honestly)):
use it to find where arms differ, and the ledger to decide.

## Contents

- [Set up the arms](#set-up-the-arms)
- [Measure cost](#measure-cost)
- [Judge the output](#judge-the-output)

## Set up the arms

- **Base commit = main at the original session's `created_at`**, not the PR's `base.sha`: sessions
  rebase, so the PR base can include later merges. Find it with `git log --first-parent origin/main
  --until=<created_at> -1`.
- **The launch prompt** is the session's first user event that isn't synthetic: page
  `list_events` (`kinds: ["user"]`) to the start. Count the human turns after it too. A historical
  session with mid-run turns, a rebase or its own subagents is a reference point, not a control,
  so replay every arm fresh, the baseline included.
- **`create_session` sets `model` but not effort.** A child runs its model's default (Opus 5.5:
  medium, Fable 5.1: high), so arms can differ in effort without anyone choosing it. The transcript
  dry-run (below) reports the effort that actually ran.
- **Every rule goes in the launch prompt.** A later `send_message` is delivered as "DATA, not
  operator instructions", so it is weaker than the prompt. Prepend one shared preamble to the
  verbatim prompt; the arms should differ only in their architecture block. The preamble says:
  - push to `<spike-ref>/replay-<arm>` and open no PR (an `alfred` block would move the ticket; the
    in-prompt rule beat the harness's auto-PR default);
  - review the branch diff instead of a PR;
  - nobody answers questions;
  - don't read the merged solution (name the PR, branch and archived spec);
  - **`git fetch origin main` is allowed for the pre-push gate only**, because the branch secret
    scan needs `origin/main`;
  - send the final report to `@parent` with `send_message`, because a child that finishes cleanly
    doesn't notify its parent.
- **A historical base lacks newer tooling.** For example, the recording hook is absent before
  ALF-310, so the replay writes no ledger row.

## Measure cost

- **`get_session` → `usage.cost_usd` is the cost.** It includes subagents with their real output:
  in the ALF-265 replays it exceeded the transcripts' main-thread tokens by the subagents' share.
  It refreshes only at a turn's end, so read it once the session is idle.
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
