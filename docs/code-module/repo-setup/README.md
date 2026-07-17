# Software Factory — per-repo setup artifacts

These are the **copy-ready artifacts** that wire a GitHub repository into alfred's
Software Factory (the `code` module — see [`code-module-spec.md`](../../specs/code-module/code-module-spec.md)).
They define the **PR ↔ ticket contract** and the **enforcing GitHub check** that keeps
PRs machine-readable.

> **Status:** This is the **M1 deliverable** — the *artifact definitions*. Actually installing
> them into a project repo (webhook, token, committed Action) is the **credentialed Phase-C
> closeout**, done per-repo in a local high-touch session. Nothing here is active
> in the `alfred` repo itself yet — installing `alfred-frontmatter.yml` into `.github/workflows/`
> would gate *every* PR, including non-factory ones.

## The PR ↔ ticket contract

Every Software-Factory PR (both phases) carries a **machine-readable fenced block** in its
description, tagged `alfred`. The webhook Worker regexes this block to drive deterministic
ticket-state transitions; there is no Anthropic session API, so **the PR is the only signal**.

````markdown
```alfred
alfred-ticket: ALF-42
phase: refinement
spec-path: docs/specs/ALF-42.html
```
````

| Field | Meaning | Rules |
|---|---|---|
| `alfred-ticket` | The story ref(s) this PR advances. | One ref, or a **comma-separated list** (`ALF-42, ALF-43`) for a PR closing several stories. Always parsed as a list. |
| `phase` | Which lifecycle phase the PR belongs to. | `refinement` \| `implementation`. |
| `spec-path` | Where the spec (a self-contained HTML plan) lives in the repo. | **Required on refinement PRs** — declares the path so alfred renders from the *recorded* path, never an inferred one. **Implementation PRs carry it too** so the archive rule (below) knows which spec to retire. |

- A **refinement** PR writes the spec artifact and opens with `phase: refinement` +
  `spec-path: docs/specs/<REF>.html`. Merging it moves the story `in_refinement → ready_for_dev` and the
  Worker snapshots the spec.
- An **implementation** PR implements the merged spec and opens with `phase: implementation`. It also
  **archives the now-consumed spec** — git-moving `docs/specs/<REF>.html` to
  `docs/specs/archive/<REF>.html` in the same PR — so the active `docs/specs/` directory only ever
  holds specs still awaiting work. Opening the PR moves the story `in_development → ready_for_review`;
  merging it moves it to `done`.

> **Archive rule.** The enforcing check **fails an implementation PR whose `spec-path` still
> resolves to a file in the active `docs/specs/` directory** (i.e. the spec was left un-archived).
> The block's `spec-path` keeps pointing at the original active path; the check derives the archive
> location from it. A **skip-refinement** (bypass) PR has no committed spec, so nothing exists at
> `spec-path` and it passes unaffected.

A refinement PR *opening* is a **no-op** for the state machine — the Worker just records
`refinement_pr_url`; back-and-forth happens through PR comments.

## Files in this folder

| File | Copy it to | Purpose |
|---|---|---|
| [`alfred-frontmatter.yml`](alfred-frontmatter.yml) | the project repo's `.github/workflows/alfred-frontmatter.yml` | The enforcing check: fails the PR when the `alfred` block is missing/malformed, when a refinement PR omits `spec-path`, or when an implementation PR leaves its spec un-archived (the archive rule above). Coding agents fix failing checks, so they self-correct. |
| the refinement skill (`.claude/skills/refinement/SKILL.md`) | the project repo's `.claude/skills/refinement/SKILL.md` | The refinement-guide convention: how a refinement session must write the spec artifact and open its PR. The Claude Code refinement prompt references this committed skill. |

## One-time per-repo setup checklist (Phase C — credentialed)

Run once per project repo, in a local session (needs GitHub admin + the Worker secrets):

1. **Commit the enforcing Action.** Copy `alfred-frontmatter.yml` → `.github/workflows/` in the
   project repo and commit it.
2. **Commit the refinement guide.** Drop the refinement skill into `.claude/skills/refinement/SKILL.md` and commit it.
3. **Add the GitHub webhook.** Repo → Settings → Webhooks → Add webhook:
   - **Payload URL:** the deployed Worker's `POST /github/webhook` route.
   - **Content type:** `application/json`.
   - **Secret:** the shared `GITHUB_WEBHOOK_SECRET` (also set as a Worker secret).
   - **Events:** *Let me select individual events* → **Pull requests** only.
4. **Provision the read token.** Ensure the Worker's fine-grained PAT (`GITHUB_TOKEN`) has
   **Contents: read** on this repo (used to snapshot the spec on refinement-merge).
5. **Smoke test.** Open a real refinement PR carrying the `alfred` block → confirm the Worker
   advances the ticket and snapshots the spec.

> The Worker itself (HMAC verify, frontmatter parse, transition table, spec snapshot) is built in
> **M7**; this checklist is the repo side that pairs with it.

## Troubleshooting: a whole repo's tickets never advance

**Symptom:** every Software-Factory ticket for one project sits in place — PRs open with a
valid `alfred` block and green checks, yet the story never moves (e.g. an implementation PR
that never reaches `ready_for_review`). It affects the *whole repo*, not one PR.

**Cause (in order of likelihood):**

1. **No webhook — step 3 above was never done.** The Worker is purely event-driven: with no
   webhook, GitHub never POSTs the `pull_request` event, so the transition never runs. It fails
   **silently** — nothing errors anywhere, which is exactly why it reads like a code bug.
2. **The webhook exists but deliveries fail.** A wrong/blank secret (HMAC mismatch → the Worker
   returns 401), the wrong Payload URL, or `Pull requests` not selected under Events.

**Diagnose it** (needs repo admin) — list the repo's hooks and check `config.url` +
`last_response`, per the `gh-cli` skill's "Inspecting & copying repo webhooks" section:

```bash
gh api repos/<owner>/<repo>/hooks --jq '.[] | {url: .config.url, events, active, last_response}'
```

No hook pointing at the Worker's `/github/webhook` → run step 3. A hook whose `last_response.code`
is 401 → the secret doesn't match the Worker's `GITHUB_WEBHOOK_SECRET`. Because the secret is
write-only (the API never returns it), fix a mismatch by re-setting it on the hook, not by copying
it from another repo.
