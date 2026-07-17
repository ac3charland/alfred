---
branch: claude/bookmark-express-tickets-debug-bukbea
---

# ALF-124: Bookmark Express tickets not advancing — root cause is a missing per-repo webhook

*2026-07-17T19:19:40.683Z*

**Symptom:** BMX-5's implementation PR opened with a valid `alfred` block and green checks, but the ticket never advanced to Ready for Review — and the same held for *every* Bookmark Express ticket.

**Isolating it:** the Worker turns a `pull_request` webhook into a ticket-state transition (`parseFrontmatter` → `planTransition`). Running that REAL code on the actual BMX-5 PR body shows it already decides `ready_for_review` for an `opened` event — so nothing in the parse/transition layer is the blocker.

```bash
node docs/demos/alf-124-tickets-not-advancing/diagnose.ts 2>/dev/null
```

```output
1. Worker parses the PR body   → tickets=BMX-5 phase=implementation
2. Worker plans 'opened' event → ready_for_review

Conclusion: the code already advances BMX-5 to ready_for_review. The ticket only
stayed put because no webhook delivered the event — the per-repo webhook (repo-setup
README, step 3) was never added for bookmark-express. Fix = ops, not code.
```

**Fix (this PR):** because the cause is ops, not code, the deliverable is diagnostic tooling so this silent failure is caught in seconds next time — a webhook-inspection recipe in the `gh-cli` skill (`gh api repos/<o>/<r>/hooks`, reading `last_response`, and the secret-is-write-only gotcha when copying a hook) and a troubleshooting section in `docs/code-module/repo-setup/README.md` mapping the symptom to the missing/failing webhook. The operator action is repo-setup step 3: add the webhook on bookmark-express.
