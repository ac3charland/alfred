---
name: gh-cli
description: >
  Using the GitHub CLI (`gh`) and `gh api`: creating, editing, and commenting on pull requests and
  issues, updating a PR or issue body or title, scripting GitHub over REST, and inspecting a repo's
  webhooks. Use when running `gh pr`, `gh issue`, or `gh api`; when a `gh` body/title edit fails
  with a "Projects (classic)" GraphQL error; when editing a PR through the GitHub MCP server in the
  web/remote environment (no `gh`); or when diagnosing a repo's failing webhook deliveries.
---

# gh CLI skill (alfred)

**Sources:** hit and resolved in-repo (June 2026) while updating PR #7's description;
GitHub Projects-classic sunset notice (github.blog/changelog/2024-05-23-sunset-notice-projects-classic).

## Mental model

`gh` has two backends. **`gh api`** talks to the GitHub **REST** API directly. The
porcelain commands (`gh pr edit`, `gh issue edit`, `gh pr view`, …) mostly go through
**GraphQL**, and some of them fetch fields that GitHub has **deprecated** — notably
`repository.pullRequest.projectCards` (Projects *classic*). When that field errors, the
whole porcelain command can abort.

## The gotcha that bit us: `gh pr edit` fails silently on Projects-classic

Updating a PR body with `gh pr edit <n> --body-file body.md` can print:

```
GraphQL: Projects (classic) is being deprecated ... (repository.pullRequest.projectCards)
```

…and **leave the PR unchanged**. The failure is quiet: `gh pr edit` may still exit 0-ish
and even bump the PR's `updatedAt`, so it *looks* like it worked. It did not.

**Fix — set the body via REST instead of the GraphQL porcelain:**

```bash
# PR body (from a file — avoids all shell-escaping of long markdown)
gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@body.md

# PR title, or both at once
gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f title='new title'

# Issue body uses the issues endpoint
gh api -X PATCH repos/<owner>/<repo>/issues/<n> -F body=@body.md
```

`-F field=@file` reads the **file contents** as the field's string value; `-f field='...'`
passes a **literal** string. (Don't use `-F` for a literal that starts with `@` or looks
numeric/boolean — `-F` does type coercion; use `-f` for raw strings.)

## Always verify a body/title edit actually applied

Because the failure mode is silent, never trust the exit code alone — read it back and
grep for a marker you just wrote:

```bash
gh pr view <n> --json body --jq '.body' | grep -q "Status: live and in use" \
  && echo "applied" || echo "NOT applied — retry via gh api"
```

## The gotcha in the web/remote environment: the GitHub MCP server backtick-wraps URLs

In Claude Code on the web there is **no `gh`** — PRs are created/edited via the GitHub
**MCP** tools (`mcp__github__create_pull_request` / `update_pull_request`). These silently
wrap any `https://…` URL in the body in **double backticks**, so a Markdown link
`[text](https://github.com/…)` is stored as `[text](``https://…``)` and GitHub renders the
URL as **inline code, not a clickable link** (a bare URL and a reference-style `[id]: https://…`
definition are wrapped too; an `<a href>` tag is stripped entirely). The body otherwise saves
fine, so it looks like it worked.

**Fix — link with a root-relative path (no `https://` token to wrap):**

```text
📝 **Demo:** [path/to/file.md](/<owner>/<repo>/blob/<branch>/path/to/file.md)
```

GitHub resolves a leading-`/` href against `github.com`, so `/ac3charland/alfred/blob/<branch>/…`
is a real clickable link to the blob on the head branch — and contains no `https://`, so the
wrapper leaves it alone. **`npm run demo -- pr-link` already emits exactly this root-relative
form**, so its output pastes verbatim into an MCP-posted body — no conversion. Only a hand-written
`https://` link needs converting. Verify with a WebFetch of the PR page (cache-bust with `?cb=N` —
WebFetch caches a URL for 15 min) and confirm the demo text is an anchor, not inline code.

## What still works fine (don't over-correct)

Only the project-card-fetching porcelain paths are affected. In this repo these worked
without issue: `gh pr create`, `gh pr comment`, `gh pr view --json <fields>`,
`gh pr list`, `gh api ...`. So reach for `gh api -X PATCH` specifically when an **edit**
of a PR/issue body or title trips the Projects-classic GraphQL error — there's no need to
abandon `gh` porcelain everywhere.

## Inspecting & copying repo webhooks (`gh api .../hooks`)

The Software-Factory Worker turns `pull_request` webhooks into ticket-state transitions, so
**a repo with no (or a failing) webhook is silent — its tickets never advance and nothing
errors.** That's the first thing to check when a whole repo's factory tickets are stuck (see
the repo-setup README's troubleshooting note for the factory framing). Reading hooks needs
**repo admin** (an `admin:repo_hook`-scoped token):

```bash
# Does one point at the Worker's /github/webhook? `last_response.code` 401 = wrong secret/HMAC;
# a 2xx with no recent delivery = the event type isn't subscribed.
gh api repos/<owner>/<repo>/hooks \
  --jq '.[] | {id, url: .config.url, events, active, last_response}'

# Per-delivery history for one hook (id from above) — action, status, timing.
gh api repos/<owner>/<repo>/hooks/<hook_id>/deliveries \
  --jq '.[] | {id, event, action, status_code, delivered_at}'
```

**Copying a hook to another repo — the secret does NOT come with it.** The API never returns
`config.secret` (write-only), so you can't read it off the source; recreate on the destination
and **re-supply the shared secret yourself**, or every delivery fails HMAC (a 401 at the
Worker). Send the body as JSON to sidestep nested-field quoting:

```bash
gh api -X POST repos/<dest-owner>/<dest-repo>/hooks --input - <<'JSON'
{ "name": "web", "active": true, "events": ["pull_request"],
  "config": { "url": "https://<worker-host>/github/webhook",
              "content_type": "json",
              "secret": "<the shared GITHUB_WEBHOOK_SECRET>" } }
JSON
```

## Quick reference

| Task | Reliable command |
|---|---|
| Update PR body | `gh api -X PATCH repos/<o>/<r>/pulls/<n> -F body=@body.md` |
| Update PR title | `gh api -X PATCH repos/<o>/<r>/pulls/<n> -f title='…'` |
| Update issue body | `gh api -X PATCH repos/<o>/<r>/issues/<n> -F body=@body.md` |
| Add a PR comment | `gh pr comment <n> --body-file note.md` (porcelain OK) |
| Read a PR body back | `gh pr view <n> --json body --jq '.body'` |
| Get owner/repo for a path | `gh repo view --json nameWithOwner --jq '.nameWithOwner'` |
| List a repo's webhooks | `gh api repos/<o>/<r>/hooks --jq '.[] \| {url: .config.url, events, last_response}'` |
