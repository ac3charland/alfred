# Context primer — build an `alfred` integration skill

**Paste this whole document into the productivity-coach chat**, then ask it to build a skill
that talks to alfred. Everything the coach needs is here: the two endpoints, the auth header,
the exact response shapes, and two reference scripts to bundle.

alfred is a single-user, capture-first task system (Next.js on Vercel + Supabase). It already
exposes the two endpoints this integration needs — nothing has to be built on the alfred side.

The coach should end up with a skill that can:

1. **Post the week plan it generates** to alfred's archive, where it renders in the app's
   **Week Plan** view.
2. **Read this ISO week's merged-PR ratio** — the split of merged pull requests across the
   configured repos — as the key metric for the review.

---

## Fill these in before generating the skill

| Placeholder | Value |
| --- | --- |
| `<ALFRED_BASE_URL>` | The deployed app's origin, e.g. `https://alfred.example.vercel.app` — no trailing slash. |
| `<ALFRED_API_KEY>` | The value of the `INGEST_API_KEY` environment variable in the alfred deployment (Vercel → Project → Settings → Environment Variables). |

**Hardcode both into the bundled scripts.** This is a deliberate, accepted trade-off for a
single-user system: the key is a *write* credential for the ingest endpoints only — it cannot
read tasks, plans, or anything else. Treat it like a password anyway; if it leaks, rotate
`INGEST_API_KEY` in Vercel and update the skill.

## Authentication

Every call below is authenticated by that one shared key, in either of two headers:

```http title=auth-headers
x-api-key: <ALFRED_API_KEY>
Authorization: Bearer <ALFRED_API_KEY>
```

Use `x-api-key`. Two rules the server enforces that are easy to get wrong:

- **`x-api-key` wins.** If it is present, the `Authorization` header is never consulted — so a
  present-but-wrong `x-api-key` fails even alongside a correct bearer token.
- **An empty value is a mismatch,** not an absent header. A script that interpolates an unset
  variable sends `x-api-key:` and gets a `401`, not a hint.

Failed auth is always `401` with the body `{"error":"Unauthorized"}`. Every error response in
alfred uses that same envelope: a JSON object with an `error` string.

---

## Endpoint 1 — `POST /api/weekly-plans` (write the week plan)

Archives one week-plan document. The newest upload is what the app's **Week Plan** view shows;
older ones stay available in a picker. There is no update or delete — re-posting adds another
entry to the archive.

The body is the **raw HTML document**, not JSON. That is deliberate: a plan is a 30–50 KB file,
and JSON-escaping it from a shell is hostile. `Content-Type: text/html` is required.

```http title=post-weekly-plan-request
POST /api/weekly-plans
x-api-key: <ALFRED_API_KEY>
Content-Type: text/html

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Week of July 20</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <h1>Week of July 20</h1>
  </body>
</html>
```

On success the response is `201` with the archived row's id and timestamp. The document is
never echoed back:

```json title=post-weekly-plan-response
{
  "id": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  "uploaded_at": "2026-07-24T21:03:11.482Z"
}
```

### Statuses to handle

| Status | Meaning |
| --- | --- |
| `201` | Archived. Report the `uploaded_at` back to the user. |
| `400` | Body was empty/whitespace, or did not start with `<!DOCTYPE html>` / `<html>`. |
| `401` | Missing, empty, or wrong key. |
| `413` | Document exceeds 1 MB. Trim it — a plan should be well under that. |
| `415` | `Content-Type` was not `text/html`. Sending JSON lands here. |
| `500` | The database rejected the insert; the `error` string carries its message. |

### What the HTML must look like

The document renders inside `<iframe srcDoc sandbox="allow-scripts">` — scripts run, but the
frame has an **opaque origin** and no access to the parent page. So:

- **Self-contained.** Inline every style and script; no external stylesheets, fonts, or JS.
  Nothing is fetched from the app's own origin either.
- **Ship its own dark mode** via a `prefers-color-scheme` block. The view sets no background
  of its own, so a document that only styles for light mode will look broken in the app's
  dark theme.
- **No storage APIs.** `localStorage` / `sessionStorage` / cookies throw or silently fail on an
  opaque origin. Any state the document needs must be baked into the markup at generation time.
- **No parent-page assumptions.** The frame cannot read or write anything outside itself.

---

## Endpoint 2 — `GET /api/code/pr-ratio` (read the PR-ratio metric)

Returns this **ISO week's** merged-PR counts, live from the GitHub Search API — Monday 00:00
through the following Monday 00:00, in the timezone you name. This is the same number the
app's Backlog card shows.

Pass `tz` as an IANA timezone so the week boundary matches the user's actual week. An
unrecognized zone silently falls back to UTC rather than erroring, so send a valid one.

```http title=pr-ratio-request
GET /api/code/pr-ratio?tz=America/New_York
x-api-key: <ALFRED_API_KEY>
```

```json title=pr-ratio-response
{
  "week": {
    "start": "2026-07-20T00:00:00-04:00",
    "end": "2026-07-27T00:00:00-04:00",
    "timezone": "America/New_York"
  },
  "total": 9,
  "repos": [
    { "repo": "ac3charland/realplay", "label": "RealPlay", "count": 3, "percentage": 33 },
    { "repo": "ac3charland/alfred", "label": "Alfred", "count": 6, "percentage": 67 }
  ],
  "other": { "count": 0, "percentage": 0 }
}
```

Reading the payload:

- `repos` is in the deployment's configured order, which is the order to report them in.
- `percentage` values are whole numbers that sum to exactly 100 (largest-remainder rounding),
  so they can be quoted directly without re-deriving them from `count`.
- `other` counts merged PRs **outside** the configured repos and is **optional** — it is absent
  entirely on a deployment that cannot measure it. Handle the missing key.
- `week.end` is **exclusive**.
- A week with no merged PRs returns `total: 0` and all-zero percentages — that is a real answer,
  not an error.
- Counts are cached for five minutes, so two calls a minute apart can return the same numbers.

### Statuses to handle

| Status | Meaning |
| --- | --- |
| `200` | The week's split, as above. |
| `401` | Missing, empty, or wrong key. |
| `501` | This deployment has no PR-ratio configuration. The metric doesn't exist here — say so instead of reporting zero. |
| `502` | GitHub could not be reached or refused the query. Transient; retry later. Never report this as "no PRs merged." |

---

## Reference scripts to bundle

Two scripts, hardcoded values at the top, each doing exactly one thing and failing loudly.
`--fail-with-body` makes curl exit non-zero on a 4xx/5xx while still printing alfred's `error`
envelope, so the skill can surface the reason.

```bash title=post-weekly-plan.sh
#!/usr/bin/env bash
# Archive a week-plan HTML document in alfred. Usage: post-weekly-plan.sh <plan.html>
set -euo pipefail

ALFRED_BASE_URL="https://alfred.example.vercel.app"
ALFRED_API_KEY="paste-the-INGEST_API_KEY-here"

plan_file="${1:?usage: post-weekly-plan.sh <plan.html>}"

curl --fail-with-body --silent --show-error \
  --request POST "${ALFRED_BASE_URL}/api/weekly-plans" \
  --header "x-api-key: ${ALFRED_API_KEY}" \
  --header "Content-Type: text/html" \
  --data-binary "@${plan_file}"
```

```bash title=pr-ratio.sh
#!/usr/bin/env bash
# Print this ISO week's merged-PR split. Usage: pr-ratio.sh [IANA timezone]
set -euo pipefail

ALFRED_BASE_URL="https://alfred.example.vercel.app"
ALFRED_API_KEY="paste-the-INGEST_API_KEY-here"

timezone="${1:-America/New_York}"

curl --fail-with-body --silent --show-error --get \
  --data-urlencode "tz=${timezone}" \
  --header "x-api-key: ${ALFRED_API_KEY}" \
  "${ALFRED_BASE_URL}/api/code/pr-ratio"
```

## Shape of the skill to generate

- **Name it for the system, not the task** — e.g. `alfred` — since both capabilities are "talk
  to alfred."
- **Write the description around the trigger phrases the user actually says**: posting or
  publishing the week plan to alfred, and asking for this week's PR ratio / PR split /
  merged-PR breakdown.
- **Bundle both scripts** under `scripts/`, `chmod +x`, and have `SKILL.md` document the one
  command line for each rather than restating the HTTP details.
- **Point the plan script at the file the coach already generates** — the skill should write the
  plan to a temp file and pass that path, never inline a 40 KB document into a shell argument.
- **Read the exit code and the `error` field on failure** and report the actual reason. `401`
  means the key is wrong; `501` means this deployment doesn't measure the ratio at all; `502`
  is GitHub being unavailable, not a zero week.

## Out of scope

- **Reading plans back.** `GET /api/weekly-plans/[id]` exists but requires a logged-in browser
  session; the API key is write-only for the archive. The skill posts plans, it never fetches
  them.
- **Creating tasks.** alfred has a keyed capture endpoint (`POST /api/items`), but it is not
  part of this integration.
- **Editing or deleting an archived plan.** Not supported by the API — a correction is a new
  upload.
