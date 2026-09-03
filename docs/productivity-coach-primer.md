# Context primer — build an `alfred` integration skill

**Paste this whole document into the productivity-coach chat**, then ask it to build a skill
that talks to alfred. Everything the coach needs is here: the six endpoints, the auth header,
the exact response shapes, and six reference scripts to bundle.

alfred is a single-user, capture-first task system (Next.js on Vercel + Supabase). It already
exposes the six endpoints this integration needs — nothing has to be built on the alfred side.

The coach should end up with a skill that can:

1. **Post the week plan it generates** to alfred's archive, where it renders in the app's
   **Week Plan** view.
2. **Read this ISO week's merged-PR ratio** — the split of merged pull requests across the
   configured repos — as the key metric for the review.
3. **Read the owner's habit data** — each habit's definition, a window of logged days, and every
   derived number (streaks, hit rate, banked days, formation stage) — so "did you actually get up
   at 6 this week?" has an answer.
4. **Log a habit day** from chat, so a morning the owner just described in conversation gets
   recorded without opening the app.
5. **Create the week's work as real items in alfred**, attached to the plan document it just
   posted — so what the review agreed to do exists in the system that tracks work, not only in
   a document.
6. **Read that same week's items back at the next review** — which are done, when they were
   done, when they were scheduled for, and what the unfinished ones are doing — in one call.

---

## Fill these in before generating the skill

| Placeholder | Value |
| --- | --- |
| `<ALFRED_BASE_URL>` | The deployed app's origin, e.g. `https://alfred.example.vercel.app` — no trailing slash. |
| `<ALFRED_API_KEY>` | The value of the `INGEST_API_KEY` environment variable in the alfred deployment (Vercel → Project → Settings → Environment Variables). |

**Hardcode both into the bundled scripts.** This is a deliberate, accepted trade-off for a
single-user system. The key's reach is narrow but no longer write-only: it writes the plan
archive, reads the PR ratio, **reads and writes habit data**, and **creates and reads the items
attached to a week plan**. It still cannot read the owner's tasks at large, or the archived plan
documents. Treat it like a password; if it leaks, rotate `INGEST_API_KEY` in Vercel and update
the skill.

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

## Endpoint 3 — `GET /api/habits` (read the habit data)

Returns every habit the owner has defined, a window of its logged days, and every derived
number — one call answers the whole habit half of a review. There is no per-habit route and no
summary route; this is the only read.

Pass `tz` as an IANA timezone: it decides what "today" is, which decides the default window and
how the streak treats an as-yet-unlogged today. An unrecognized zone falls back to UTC rather
than erroring, and the response tells you which zone was actually used.

`from` / `to` are calendar dates (`YYYY-MM-DD`). They default to the trailing **90 days ending
today**, a `to` in the future is pulled back to today, and the effective window comes back in
the response. `include_archived=true` adds retired habits (they carry an `archived_at`); it
defaults to `false` and rejects any value other than `true` / `false`.

```http title=habits-request
GET /api/habits?tz=America/New_York&from=2026-05-01
x-api-key: <ALFRED_API_KEY>
```

```json title=habits-response
{
  "today": "2026-07-28",
  "timezone": "America/New_York",
  "window": { "from": "2026-05-01", "to": "2026-07-28" },
  "habits": [
    {
      "id": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
      "name": "Morning routine",
      "notes": null,
      "criteria": [
        { "key": "wake", "label": "Up by 6:15", "kind": "time", "target": 375, "comparator": "lte" },
        { "key": "light", "label": "Outside for light", "kind": "boolean" }
      ],
      "active_days": [1, 2, 3, 4, 5, 6, 7],
      "allowance": 1,
      "started_on": "2026-06-15",
      "archived_at": null,
      "stats": {
        "current_streak": 33,
        "longest_streak": 33,
        "average_streak": 14,
        "allowance_remaining": 1,
        "hit_rate": 0.94,
        "met_days_total": 47,
        "stage": "nearing_automaticity",
        "met": 47, "partial": 2, "missed": 1, "skipped": 0, "unknown": 0
      },
      "entries": [
        { "date": "2026-07-28", "status": "met", "results": { "wake": 364, "light": true }, "note": null },
        { "date": "2026-07-27", "status": "partial", "results": { "wake": 362, "light": false }, "note": null },
        { "date": "2026-07-26", "status": "skipped", "results": null, "note": "travel" }
      ]
    }
  ]
}
```

### Which figures are all-history, and which are the window

This is the one thing the shape cannot tell you, and quoting a windowed number as a lifetime
one (or the reverse) is the easiest way to say something false:

| Field | Measured over | Notes |
| --- | --- | --- |
| `current_streak` | **all history** | Counts **met** days, not elapsed days — a run carried across a forgiven day reads one lower than the calendar span. |
| `longest_streak` | **all history** | |
| `average_streak` | **all history** | Mean of **completed** runs; the one in progress is excluded. `null` until a run has ended. Rounded to 1 decimal. |
| `allowance_remaining` | **trailing 7 days** | Its own fixed window by definition — `from`/`to` do not affect it. |
| `met_days_total` | **all history** | The banked days the formation stage is keyed to. Never decreases. |
| `stage` | **all history** | `fully_deliberate` · `gaining_momentum` · `nearing_automaticity` · `possibly_established`. |
| `hit_rate` | **the window** | `met / (met + partial + missed)`. `null` when that denominator is 0. Rounded to 3 decimals. |
| `met` … `unknown` | **the window** | Counts of days the habit applies to. `unknown` = applies, in the window, never logged. |
| `entries` | **the window** | Newest first. Only days with a row; a day never logged simply isn't in the list. |

Asking for a different window changes `hit_rate`, the five counts and `entries`. It does **not**
change the streaks, `met_days_total` or `stage` — if those move between two calls, the data
changed, not the question.

### Reading notes the coach will otherwise get wrong

- **The streak counts met days, not elapsed days.** A 35-day unbroken run containing two
  forgiven days reads `33`. That is not an off-by-one.
- **`unknown` is a day that was never logged.** It costs allowance exactly like a miss — the
  chain does not distinguish "failed" from "didn't say" — but it sits on **neither** side of
  the hit rate, so the percentage stays truthful about days that were actually rated.
- **`skipped` is excused** (illness, travel; it always carries a reason in `note`). It costs
  nothing, extends nothing, and appears in no hit-rate denominator.
- **`allowance` is a rule, not a currency.** `allowance_remaining: 0` means the next non-met
  day breaks the chain, not that something has been "spent well".
- **`stage` is deliberately approximate.** Report the top rung as **"Possibly Established"**,
  never "Established" — the 66-day threshold is a median from research whose observed range was
  18–254 days.
- **`results` values match the criterion's `kind`.** A `time` criterion stores minutes after
  local midnight (`364` = 06:04, `target: 375` = 06:15); `count` and `duration` store plain
  numbers; `boolean` stores `true` / `false`.
- **No habits is a real answer.** `200` with `"habits": []` means none are defined.

### Statuses to handle

| Status | Meaning |
| --- | --- |
| `200` | The payload above, possibly with an empty `habits` list. |
| `400` | An unparseable `from`/`to`, `from` after `to`, a window over 366 days, or an `include_archived` that isn't `true`/`false`. The `error` string names which. |
| `401` | Missing, empty, or wrong key. |
| `500` | The database read failed. Never report this as "no habits logged." |

---

## Endpoint 4 — `PUT /api/habits/[id]/entries` (log or correct one day)

Records one day against one habit. Idempotent by `(habit, date)`: re-sending a day overwrites
it, which is also how a correction is made. Take the `id` from Endpoint 3's payload.

**Send evidence, not a verdict.** Put the measured values in `results`, keyed by the criterion
keys from that habit's `criteria`, and the server scores the day and stores the status it
derived. You cannot state `met`, `partial` or `missed` — a row must never claim a verdict its
own evidence contradicts.

```http title=log-habit-request
PUT /api/habits/6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8/entries
x-api-key: <ALFRED_API_KEY>
Content-Type: application/json

{ "tz": "America/New_York", "results": { "wake": 365, "light": true } }
```

The response is the stored row, carrying the status the server derived:

```json title=log-habit-response
{
  "id": "b21c7f04-1d3e-4a55-9c80-2f7e5a4b6d19",
  "habit_id": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  "entry_date": "2026-07-28",
  "status": "met",
  "results": { "wake": 365, "light": true },
  "note": null,
  "created_at": "2026-07-28T11:02:44.117Z",
  "updated_at": "2026-07-28T11:02:44.117Z"
}
```

The body's four fields:

- **`results`** — one value per criterion key. Omitting a key means "not recorded", which is
  not the same as `false` and is never a pass. Required unless `status` is sent.
- **`date`** — the day being logged, `YYYY-MM-DD`. Omitted means **today in `tz`**. Backfilling
  an earlier day is fine. A date **before the habit's `started_on` moves that start back to it** —
  the owner was already keeping the habit then. Say so when you do it: the days in between become
  days the habit was running, and any of them left unlogged spends allowance.
- **`tz`** — the IANA zone "today" is resolved in. Unrecognized falls back to UTC.
- **`status`** — accepts exactly one value, `"skipped"`, the one verdict no evidence can
  produce. It **requires a non-empty `note`** giving the reason. Use it for illness or travel,
  not for a day that simply went badly.
- **`note`** — free text; required with `skipped`, optional otherwise.

### Statuses to handle

| Status | Meaning |
| --- | --- |
| `200` | Logged. The response's `status` is the verdict — report that back, don't guess it from the results. |
| `400` | A future `date`, a `skipped` with no reason, or a body with neither `results` nor `status`. |
| `401` | Missing, empty, or wrong key. |
| `404` | No habit with that id. Re-read Endpoint 3 rather than retrying. |
| `500` | The database rejected the write; the `error` string carries its message. |

---

## Endpoint 5 — `POST /api/weekly-plans/{planId}/items` (create the week's work)

Turns the work the plan describes into real alfred items, in one call, attached to the plan they
came from. **Take `planId` from Endpoint 1's response** — post the plan first, then create the
items against the id it hands back. That association is the whole mechanism: it is how Endpoint 6
knows which items were this week's.

Everything created lands in the owner's **Inbox**, untriaged — no folder, nothing dispatched.
Filing is a human act on Friday, and the endpoint deliberately cannot do it.

```http title=create-plan-items-request
POST /api/weekly-plans/6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8/items
x-api-key: <ALFRED_API_KEY>
Content-Type: application/json
```

```json title=create-plan-items-body
{
  "items": [
    {
      "item_type": "task",
      "title": "Ship the motivic harness spike",
      "notes": "Timebox to Tuesday morning",
      "due_date": "2026-09-08",
      "priority": "high",
      "children": [
        { "title": "Re-read last week's findings doc" },
        { "title": "Write the harness skeleton", "due_date": "2026-09-08" }
      ]
    },
    {
      "item_type": "code",
      "title": "Per-voice mute in the mixer",
      "children": [
        { "title": "Mute state in the audio graph" },
        { "title": "Mixer strip mute button" }
      ]
    },
    { "title": "Decide what Q4's third rock actually is" }
  ]
}
```

Three roots, three types: a scheduled task with subtasks, a code item shaped like an epic under
construction, and a bare capture alfred's own classifier will type.

### What each type may carry

`item_type` decides which other fields are legal, and a field the type forbids is a `400` naming
it — never a silently dropped value. This mirrors alfred's own database constraints, so there is
nothing to guess:

| Field | `task` | `code` | `unclassified` (the default) |
| --- | --- | --- | --- |
| `title` (required, non-empty) | ✓ | ✓ | ✓ |
| `notes` | ✓ | ✓ | ✓ |
| `due_date` (`YYYY-MM-DD` or a full ISO datetime) | ✓ | — | — |
| `priority` (`high` \| `medium` \| `low`) | ✓ | — | — |
| `children` | ✓ any number | ✓ one level | — |

A **child** carries `title`, `notes`, and — under a `task` root — `due_date` and `priority`. It
never states its own `item_type` (it inherits its root's) and never has `children` of its own.
No other keys are accepted anywhere: an unrecognised key is a `400`, so a typo is loud.

A batch carries **1–100 nodes in total**, counting roots and children together.

### The one thing that will otherwise surprise you

alfred runs an LLM classifier over new Inbox items a minute or two after they arrive. It only
fills in fields you left blank, so it can never contradict what you sent — but that means:

> **A plan line with a day in it is a `task` and carries its `due_date`.** Send a task with no
> due date and the classifier may infer one from the title ("file taxes by the 15th"), and
> Endpoint 6 will then report that as the day the item was scheduled for — a date you never
> chose but would quote back as if you had. The review is planning day by day anyway, so say the
> day.

What it adds otherwise is pure upside: a folder suggestion on a task, and a project/epic hint on
a code item.

### Response — `201`

```json title=create-plan-items-response
{
  "plan": { "id": "6f1a2b3c-…", "uploaded_at": "2026-09-05T21:03:11.482Z" },
  "created": 7,
  "items": [ "…one node per created item, in the same shape Endpoint 6 returns…" ]
}
```

`created` counts every node written, roots and children alike.

### Statuses to handle

| Status | Meaning |
| --- | --- |
| `201` | Created. |
| `400` | The body isn't JSON, or breaks the table above: an empty batch, over 100 nodes, a blank title, an unknown key, a grandchild, a child stating its own type, or a field the root's type forbids. `details` carries the per-field validation issues. |
| `401` | Missing, empty, or wrong key. |
| `404` | No archived plan with that id. Nothing was written — re-post the plan and use the id it returns. |
| `500` | The write failed. **Nothing was written**: the whole batch is one transaction, so a retry cannot half-duplicate a week. |

**There is no de-duplication.** Two identical calls create two sets of items. Create the week
once, right after posting the plan.

---

## Endpoint 6 — `GET /api/weekly-plans/{planId|latest}/items` (read what happened)

The other half of the loop, and the call the next review opens with. Use the literal segment
**`latest`** — it resolves to the most recent plan that actually has items, so it stays correct
whether the last review was on Friday, slipped to Sunday, or was skipped. No arguments, no date
arithmetic.

```http title=plan-items-request
GET /api/weekly-plans/latest/items
x-api-key: <ALFRED_API_KEY>
```

```json title=plan-items-response
{
  "plan": { "id": "6f1a2b3c-…", "uploaded_at": "2026-09-05T21:03:11.482Z" },
  "counts": { "total": 21, "done": 14, "open": 6, "abandoned": 1, "untriaged": 2 },
  "items": [
    {
      "id": "9c2e…",
      "item_type": "task",
      "title": "Ship the motivic harness spike",
      "notes": "Timebox to Tuesday morning",
      "due_date": "2026-09-08",
      "priority": "high",
      "state": "completed",
      "done": true,
      "done_at": "2026-09-08T19:41:08.221Z",
      "created_at": "2026-09-05T21:04:02.118Z",
      "folder": { "id": "b41f…", "name": "RealPlay" },
      "in_inbox": false,
      "code": null,
      "children": []
    },
    {
      "id": "77ab…",
      "item_type": "code",
      "title": "Mute state in the audio graph",
      "notes": null, "due_date": null, "priority": null,
      "state": "ready_for_review",
      "done": false,
      "done_at": null,
      "created_at": "2026-09-05T21:04:02.117Z",
      "folder": null, "in_inbox": false,
      "code": { "ref": "RPL-142", "lane": "human" },
      "children": []
    }
  ]
}
```

### Reading it

| Key | Meaning |
| --- | --- |
| `plan` | The week being reported on — say which week rather than assuming. `null` only when no items have ever been created. |
| `counts.total` | Every node still in alfred. An item the owner deleted is simply absent. |
| `counts.done` | Nodes with `done: true`. |
| `counts.abandoned` | Nodes given up on. Not done, and not still open. |
| `counts.open` | Everything else. `done + open + abandoned = total`. |
| `counts.untriaged` | Nodes still sitting in the Inbox. This **cross-cuts** the other three, so it does not sum with them — and a high number a week later is itself the finding: the plan was written and never engaged with. |
| `items` | Roots in the order they were created, each with its children. |
| `…state` | Where the item is **now**, in one vocabulary: `active` / `completed` for a task or an untyped capture; a Software Factory state (`in_development`, `ready_for_review`, `blocked`, `done`, `abandoned`, …) for a story being built. This is the "if it isn't done, what is it doing?" answer. |
| `…done` / `…done_at` | Whether it is finished, and when. `done_at` can be `null` on a story that shipped before this feature existed — alfred kept no record of the moment. |
| `…code` | A story's factory identity (`ref`, `lane`) — `RPL-142` is what you quote — or `null`. `null` on a `code`-typed item means it was planned as code and never entered the factory. |
| `…folder` / `…in_inbox` | Where it was filed, and whether it was ever triaged at all. |

**Do not compute completion yourself.** A code story's raw status is always "active" in alfred's
task model — completion is a task-only concept there — so `done` and `state` are the derived
answers, and the counts are computed from exactly the same rule.

**An empty answer is a real answer.** With no cohort at all you get `200` with `"plan": null`,
zeroed counts and `"items": []` — never a `404`.

### Statuses to handle

| Status | Meaning |
| --- | --- |
| `200` | The payload above, including the empty case. A plan that exists but has nothing attached is also a `200` with an empty list — planning nothing is not an error. |
| `400` | The path segment is neither a plan id nor `latest`. |
| `401` | Missing, empty, or wrong key. |
| `404` | An explicit plan id that names nothing. |
| `500` | The read failed. **Never report this as "nothing was done."** |

---

## Reference scripts to bundle

Six scripts, hardcoded values at the top, each doing exactly one thing and failing loudly.
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

```bash title=habits.sh
#!/usr/bin/env bash
# Print every habit with its window of days and derived stats.
# Usage: habits.sh [IANA timezone] [from YYYY-MM-DD] [to YYYY-MM-DD]
set -euo pipefail

ALFRED_BASE_URL="https://alfred.example.vercel.app"
ALFRED_API_KEY="paste-the-INGEST_API_KEY-here"

timezone="${1:-America/New_York}"
from="${2:-}"
to="${3:-}"

args=(--data-urlencode "tz=${timezone}")
if [ -n "${from}" ]; then args+=(--data-urlencode "from=${from}"); fi
if [ -n "${to}" ]; then args+=(--data-urlencode "to=${to}"); fi

curl --fail-with-body --silent --show-error --get \
  "${args[@]}" \
  --header "x-api-key: ${ALFRED_API_KEY}" \
  "${ALFRED_BASE_URL}/api/habits"
```

```bash title=log-habit.sh
#!/usr/bin/env bash
# Log or correct one day of a habit. The server derives the status from the results.
# Usage: log-habit.sh <habit-id> '<results-json>' [date YYYY-MM-DD]
#   e.g. log-habit.sh 6f1a2b3c-… '{"wake":365,"light":true}' 2026-07-27
set -euo pipefail

ALFRED_BASE_URL="https://alfred.example.vercel.app"
ALFRED_API_KEY="paste-the-INGEST_API_KEY-here"
TIMEZONE="America/New_York"

habit_id="${1:?usage: log-habit.sh <habit-id> '<results-json>' [date]}"
results="${2:?usage: log-habit.sh <habit-id> '<results-json>' [date]}"
date="${3:-}"

body="{\"tz\":\"${TIMEZONE}\",\"results\":${results}}"
if [ -n "${date}" ]; then
  body="{\"tz\":\"${TIMEZONE}\",\"date\":\"${date}\",\"results\":${results}}"
fi

curl --fail-with-body --silent --show-error \
  --request PUT "${ALFRED_BASE_URL}/api/habits/${habit_id}/entries" \
  --header "x-api-key: ${ALFRED_API_KEY}" \
  --header "Content-Type: application/json" \
  --data "${body}"
```

```bash title=create-plan-items.sh
#!/usr/bin/env bash
# Create a week's items in alfred against the plan they came from.
# Usage: create-plan-items.sh <plan-id> <items.json>
#   items.json is the whole request body: {"items":[…]}
set -euo pipefail

ALFRED_BASE_URL="https://alfred.example.vercel.app"
ALFRED_API_KEY="paste-the-INGEST_API_KEY-here"

plan_id="${1:?usage: create-plan-items.sh <plan-id> <items.json>}"
items_file="${2:?usage: create-plan-items.sh <plan-id> <items.json>}"

curl --fail-with-body --silent --show-error \
  --request POST "${ALFRED_BASE_URL}/api/weekly-plans/${plan_id}/items" \
  --header "x-api-key: ${ALFRED_API_KEY}" \
  --header "Content-Type: application/json" \
  --data-binary "@${items_file}"
```

```bash title=plan-items.sh
#!/usr/bin/env bash
# Print last week's planned items and what became of them.
# Usage: plan-items.sh [plan-id]   (default: latest — the newest plan that has items)
set -euo pipefail

ALFRED_BASE_URL="https://alfred.example.vercel.app"
ALFRED_API_KEY="paste-the-INGEST_API_KEY-here"

plan_id="${1:-latest}"

curl --fail-with-body --silent --show-error \
  --header "x-api-key: ${ALFRED_API_KEY}" \
  "${ALFRED_BASE_URL}/api/weekly-plans/${plan_id}/items"
```

## Shape of the skill to generate

- **Name it for the system, not the task** — e.g. `alfred` — since every capability is "talk
  to alfred."
- **Write the description around the trigger phrases the user actually says**: posting or
  publishing the week plan to alfred, asking for this week's PR ratio / PR split / merged-PR
  breakdown, asking how a habit or streak is going, and describing a morning to be logged
  ("I was up at 6:05 and got outside"), and asking what happened to last week's plan.
- **Bundle all six scripts** under `scripts/`, `chmod +x`, and have `SKILL.md` document the one
  command line for each rather than restating the HTTP details.
- **Point the plan script at the file the coach already generates** — the skill should write the
  plan to a temp file and pass that path, never inline a 40 KB document into a shell argument.
- **Read the exit code and the `error` field on failure** and report the actual reason. `401`
  means the key is wrong; `501` means this deployment doesn't measure the ratio at all; `502`
  is GitHub being unavailable, not a zero week.
- **Read a habit before logging against it.** The habit id and its criterion keys both come
  from Endpoint 3, and guessing either produces a `404` or a silently unrecorded criterion.
- **Post the plan, then create its items, in that order** — Endpoint 5 needs the id Endpoint 1
  returns — and open the next review with Endpoint 6 before asking the owner what got done.

## Out of scope

- **Reading plans back.** `GET /api/weekly-plans/[id]` exists but requires a logged-in browser
  session; the API key is write-only for the archive. The skill posts plans, it never fetches
  them.
- **Creating projects, epics or stories.** Endpoint 5 creates items, `code`-typed ones
  included, but admitting one to the Software Factory stays a human act in the app — which is
  also where its project and epic get chosen. Don't send `intended_project_id` / `intended_epic_id`:
  they aren't accepted, and alfred's classifier fills them.
- **Filing, updating or deleting the items you created.** Everything lands in the Inbox for the
  owner to triage, and there is no PATCH or DELETE — a mis-created week is fixed at the keyboard.
- **Editing or deleting an archived plan.** Not supported by the API — a correction is a new
  upload.
- **Creating, editing or archiving a habit.** Defining a habit is a deliberate act at a
  keyboard and requires a browser session. The skill logs days against habits the owner has
  already defined in the app; if a habit the user describes isn't in Endpoint 3's list, say so
  rather than trying to create it.
