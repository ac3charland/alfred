# routines/

The procedures alfred's Claude Code Routines follow at run time. A Routine clones this repo and
its saved prompt points at one `SKILL.md` here, so the procedure is an ordinary reviewed file — a
tuning is a commit with a diff, not an edit in a web form.

These are **not** dev skills. They sit outside `.claude/skills/` on purpose: nothing here is
auto-loaded into a development session, and a dev agent never follows one. Each routine's saved
prompt is committed beside its skill as `PROMPT.md` — the exact text pasted into the Routine at
claude.ai/code/routines — so the prompt and the procedure it names change together.

| Routine | Fired by | Procedure |
| --- | --- | --- |
| alfred research | `POST /api/reader/research` (Inbox Dispatch) and the Reader's Retry research | [`research/SKILL.md`](research/SKILL.md) |
