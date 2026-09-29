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

## Setting up alfred research

Research stays off until all three `RESEARCH_*` vars are set on the deployment (see
`frontend/.env.example`).

1. Generate the delivery key once: `openssl rand -hex 32`. It goes in steps 2 and 4, nowhere else.
2. At claude.ai/code, create a cloud environment **research**: Network access **Full**; environment
   variable `ALFRED_URL=https://<alfred's production host>` (no trailing slash). Save, reopen it,
   and add an **API credential**: allowed host = alfred's host, header `Authorization`, prefix
   `Bearer`, value = the key. The proxy attaches it outside the session, which never sees it.
3. At claude.ai/code/routines, create **alfred research**: repository `ac3charland/alfred`,
   environment research, the strongest model offered, no connectors, prompt =
   [`research/PROMPT.md`](research/PROMPT.md) verbatim. Save, then add an **API** trigger and copy
   its URL and token.
4. On the production deployment set `RESEARCH_ROUTINE_FIRE_URL`, `RESEARCH_ROUTINE_FIRE_TOKEN`
   (from step 3) and `RESEARCH_DELIVERY_KEY` (step 1), and redeploy.
5. Smoke test: capture a question, classify it Research, Dispatch. In the Reader, open *Session* and
   watch it search, fetch and deliver; within a Reader tick of delivery the row shows its summary.
