# Software Factory — per-repo setup artifacts

These are the **copy-ready artifacts** that wire a GitHub repository into alfred's
Software Factory (the `code` module — see [`../../code-module-spec.md`](../../code-module-spec.md)).
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
spec-path: specs/ALF-42.md
```
````

| Field | Meaning | Rules |
|---|---|---|
| `alfred-ticket` | The story ref(s) this PR advances. | One ref, or a **comma-separated list** (`ALF-42, ALF-43`) for a PR closing several stories. Always parsed as a list. |
| `phase` | Which lifecycle phase the PR belongs to. | `refinement` \| `implementation`. |
| `spec-path` | Where the spec markdown lives in the repo. | **Refinement PRs only** — declares the path so alfred renders from the *recorded* path, never an inferred one. |

- A **refinement** PR writes the spec artifact and opens with `phase: refinement` +
  `spec-path: specs/<REF>.md`. Merging it moves the story `in_refinement → ready_for_dev` and the
  Worker snapshots the spec.
- An **implementation** PR implements the merged spec and opens with `phase: implementation`.
  Opening it moves the story `in_development → ready_for_review`; merging it moves it to `done`.

A refinement PR *opening* is a **no-op** for the state machine — the Worker just records
`refinement_pr_url`; back-and-forth happens through PR comments.

## Files in this folder

| File | Copy it to | Purpose |
|---|---|---|
| [`alfred-frontmatter.yml`](alfred-frontmatter.yml) | the project repo's `.github/workflows/alfred-frontmatter.yml` | The enforcing check: fails the PR when the `alfred` block is missing/malformed, or when a refinement PR omits `spec-path`. Coding agents fix failing checks, so they self-correct. |
| [`refinement.md`](refinement.md) | the project repo's `.alfred/refinement.md` | The refinement-guide convention: how a refinement session must write the spec artifact and open its PR. The Claude Code refinement prompt references this committed file. |

## One-time per-repo setup checklist (Phase C — credentialed)

Run once per project repo, in a local session (needs GitHub admin + the Worker secrets):

1. **Commit the enforcing Action.** Copy `alfred-frontmatter.yml` → `.github/workflows/` in the
   project repo and commit it.
2. **Commit the refinement guide.** Copy `refinement.md` → `.alfred/refinement.md` and commit it.
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
