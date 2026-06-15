---
branch: feat/code-module-m7-worker
---

# Software Factory webhook Worker (M7)

*2026-06-15T13:48:37.553Z*

M7 builds the GitHub PR webhook Worker (`workers/src/`): one signature-verified endpoint, no LLM, that turns `pull_request` events into deterministic `code_items` state transitions. Because both lifecycle phases end in a PR, this single Worker tracks the whole factory. Pipeline per delivery: **verify HMAC → it's a pull_request → parse the `alfred` block → plan the transition → PATCH the ticket(s) → (on refinement-merge) snapshot the spec**. All evidence below is deterministic and reproducible with `npm run demo -- verify`.

**The signature contract (§13.1).** GitHub signs each delivery as `X-Hub-Signature-256: sha256=HMAC-SHA256(secret, rawBody)`; the Worker recomputes it with Web Crypto and rejects (401) on any mismatch so ticket state can't be forged. Here's the exact signature the Worker recomputes for a sample body + shared secret:

```bash
printf "%s" "{\"action\":\"closed\",\"pull_request\":{\"merged\":true}}" | openssl dgst -sha256 -hmac "demo-webhook-secret" | awk "{print \"sha256=\" \$NF}"
```

```output
sha256=e23a67af14da097cd7d2d9a40a028b005cc1473d4b51af5ae5dbed6354e04baf
```

**The PR → state transition table (§5.2 / §13.2)** the Worker implements, keyed by `(phase, action, merged)`:

| phase | action | merged | → factory_state | side-effect |
|---|---|---|---|---|
| refinement | opened | — | *(no change)* | record `refinement_pr_url` |
| refinement | closed | yes | `ready_for_dev` | record `spec_path`; **snapshot spec** |
| refinement | closed | no | `needs_refinement` | (revert) |
| implementation | opened | — | `ready_for_review` | record `implementation_pr_url` |
| implementation | closed | yes | `done` | — |
| implementation | closed | no | `ready_for_dev` | (revert) |

Any other action (`edited`, `synchronize`, `reopened`, …) is a no-op. The PR description carries a machine-readable `alfred` block (`alfred-ticket` list + `phase` + `spec-path`) the Worker regexes — no `yaml` dep.

**The whole pipeline is unit-tested end to end.** The suite signs a real HMAC, posts a sample `pull_request` payload through the Worker's `fetch` handler (with `fetch` mocked for Supabase + GitHub), and asserts the resulting state change and spec snapshot — plus HMAC accept/reject, frontmatter parsing (single ref, comma-list, malformed), and every transition row:

```bash
npm test -w workers -- --runInBand 2>&1 | grep -E "Test Suites:|Tests:"
```

```output
Test Suites: 6 passed, 6 total
Tests:       37 passed, 37 total
```

Two of those 37 are the full-handler integration cases that map directly to the lifecycle: *"advances a ticket when an implementation PR opens"* (→ `ready_for_review`, records the PR url) and *"snapshots the spec when a refinement PR merges"* (→ `ready_for_dev`, fetches the spec via the GitHub Contents API and PATCHes `spec_markdown` + `spec_sha` onto the ticket). A third asserts a forged signature is rejected with 401.

**Going live (Phase C, credentialed).** The Worker code is sandbox-complete; deploying it needs a Cloudflare account + the four secrets + each repo's webhook — see [`docs/code-module/worker-deploy.md`](../../code-module/worker-deploy.md) and [`docs/code-module/repo-setup/README.md`](../../code-module/repo-setup/README.md).
