---
name: gh-cli
description: >
  Covers using the GitHub CLI (`gh`): opening or editing pull requests and
  issues, setting/updating a PR or issue body or title, commenting, and scripting GitHub via
  `gh api`. Use when running `gh pr create`, `gh pr edit`, `gh pr comment`, `gh issue edit`, or `gh api` —
  "update the PR description", "edit the PR body", or a `gh` command that errors with a
  GraphQL / "Projects (classic)" message. Also covers editing PRs through the GitHub MCP
  server in the web/remote environment (no `gh`) — e.g. a demo/body link rendering as inline
  code because the URL got backtick-wrapped. This is where the project's commit → push → PR
  workflow (see CLAUDE.md) meets the GitHub CLI.
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
wrapper leaves it alone. (`npm run demo -- pr-link` emits an *absolute* `https://` blob URL,
which is correct for `gh`; when posting through the MCP server, convert it to the root-relative
form first.) Verify with a WebFetch of the PR page (cache-bust with `?cb=N` — WebFetch caches a
URL for 15 min) and confirm the demo text is an anchor, not inline code.

## What still works fine (don't over-correct)

Only the project-card-fetching porcelain paths are affected. In this repo these worked
without issue: `gh pr create`, `gh pr comment`, `gh pr view --json <fields>`,
`gh pr list`, `gh api ...`. So reach for `gh api -X PATCH` specifically when an **edit**
of a PR/issue body or title trips the Projects-classic GraphQL error — there's no need to
abandon `gh` porcelain everywhere.

## Quick reference

| Task | Reliable command |
|---|---|
| Update PR body | `gh api -X PATCH repos/<o>/<r>/pulls/<n> -F body=@body.md` |
| Update PR title | `gh api -X PATCH repos/<o>/<r>/pulls/<n> -f title='…'` |
| Update issue body | `gh api -X PATCH repos/<o>/<r>/issues/<n> -F body=@body.md` |
| Add a PR comment | `gh pr comment <n> --body-file note.md` (porcelain OK) |
| Read a PR body back | `gh pr view <n> --json body --jq '.body'` |
| Get owner/repo for a path | `gh repo view --json nameWithOwner --jq '.nameWithOwner'` |
