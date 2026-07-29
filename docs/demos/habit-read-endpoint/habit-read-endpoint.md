---
branch: claude/alf-148-habit-endpoints-67060c
---

# GET /api/habits — the habit read the productivity coach calls

*2026-07-29T16:01:27.162Z*

The coach already posts the week plan and reads the PR ratio. This adds the third thing a Friday review needs: `GET /api/habits` — every habit's definition, a window of its logged days, and every derived number, in one keyed call. Nothing in the app changes; the store still seeds itself the way it did.

Below, the app runs against the in-memory Supabase backend the E2E suite wires up — real route handler, real Supabase client, no live database. The seeded habit is the epic's reference one: up by 6:15 **and** outside for light, every day, one forgiven miss per rolling week. It has seven days of history ending yesterday (one `partial`, one `skipped`), and today is not logged yet.

## 1. The payload

One keyed `GET` with no parameters: the trailing 90 days ending today, in UTC.

```bash
cd frontend
# Boot the app against the in-memory Supabase backend the e2e suite uses — real route
# handler, real Supabase client, no live database.
export MOCK_SUPABASE_PORT=54332 INGEST_API_KEY=demo-ingest-key
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54332 \
       NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock \
       SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
[ -d .next ] || npm run build >/dev/null 2>&1
node scripts/mock-supabase.mjs >/dev/null 2>&1 & MOCK=$!
npm run start -- -p 3011 >/dev/null 2>&1 & APP=$!
# `npm run start` spawns next-server as a child, so kill the child too or it outlives the
# block and holds the port.
cleanup() { pkill -P "$APP" 2>/dev/null; kill "$APP" "$MOCK" 2>/dev/null; }
trap cleanup EXIT
until curl -sf localhost:54332/__mock__/health >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null localhost:3011/login 2>/dev/null; do sleep 0.5; done

KEY="x-api-key: demo-ingest-key"
API=localhost:3011/api/habits
HABIT=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8
ARCHIVED=8c2d1e0f-7a6b-4c5d-9e8f-1a2b3c4d5e6f

# Every date below is relative to whenever this runs, so the captured output masks them back
# to <today> / <today-N>. The doc stays readable and re-verifies on any day.
day() { date -u -d "$1 days ago" +%F; }
mask() { sed $(for n in 0 1 2 3 4 5 6 7 8 89 90 365 366; do printf -- "-e s/%s/<today-%s>/g " "$(day $n)" "$n"; done) -e "s/<today-0>/<today>/g"; }

# The reference habit: up by 6:15 AND outside for light, every day, one forgiven miss per
# rolling week. Seven days of history ending yesterday, today still unlogged — plus an
# archived habit to prove include_archived.
entry() { printf "{\"habit_id\":\"%s\",\"entry_date\":\"%s\",\"status\":\"%s\",\"results\":%s,\"note\":%s}" "$1" "$(day $2)" "$3" "$4" "$5"; }
MET='{"wake":364,"light":true}'
seed() {
cat <<JSON | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- localhost:54332/__mock__/seed >/dev/null
{"habits":[
  {"id":"$HABIT","name":"Morning routine","notes":null,"sort_order":1,"allowance":1,"started_on":"$(day 7)",
   "criteria":[{"key":"wake","label":"Up by 6:15","kind":"time","target":375,"comparator":"lte"},
               {"key":"light","label":"Outside for light","kind":"boolean"}]},
  {"id":"$ARCHIVED","name":"Evening wind-down","notes":null,"sort_order":2,"allowance":0,"started_on":"$(day 7)",
   "archived_at":"$(day 2)T12:00:00Z",
   "criteria":[{"key":"screens","label":"Screens off by 22:30","kind":"time","target":1350,"comparator":"lte"}]}],
 "habitEntries":[
  $(entry "$HABIT" 7 met "$MET" null),
  $(entry "$HABIT" 6 met "$MET" null),
  $(entry "$HABIT" 5 partial '{"wake":362,"light":false}' null),
  $(entry "$HABIT" 4 met "$MET" null),
  $(entry "$HABIT" 3 skipped null '"travel"'),
  $(entry "$HABIT" 2 met "$MET" null),
  $(entry "$HABIT" 1 met "$MET" null),
  $(entry "$ARCHIVED" 5 met '{"screens":1320}' null),
  $(entry "$ARCHIVED" 4 met '{"screens":1340}' null)]}
JSON
}
seed
curl -sf -H "$KEY" "$API?tz=UTC" | jq . | mask
```

```output
{
  "today": "<today>",
  "timezone": "UTC",
  "window": {
    "from": "<today-89>",
    "to": "<today>"
  },
  "habits": [
    {
      "id": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
      "name": "Morning routine",
      "notes": null,
      "criteria": [
        {
          "key": "wake",
          "label": "Up by 6:15",
          "kind": "time",
          "target": 375,
          "comparator": "lte"
        },
        {
          "key": "light",
          "label": "Outside for light",
          "kind": "boolean"
        }
      ],
      "active_days": [
        1,
        2,
        3,
        4,
        5,
        6,
        7
      ],
      "allowance": 1,
      "started_on": "<today-7>",
      "archived_at": null,
      "stats": {
        "current_streak": 5,
        "longest_streak": 5,
        "average_streak": null,
        "allowance_remaining": 0,
        "hit_rate": 0.833,
        "met_days_total": 5,
        "stage": "fully_deliberate",
        "met": 5,
        "partial": 1,
        "missed": 0,
        "skipped": 1,
        "unknown": 1
      },
      "entries": [
        {
          "date": "<today-1>",
          "status": "met",
          "results": {
            "wake": 364,
            "light": true
          },
          "note": null
        },
        {
          "date": "<today-2>",
          "status": "met",
          "results": {
            "wake": 364,
            "light": true
          },
          "note": null
        },
        {
          "date": "<today-3>",
          "status": "skipped",
          "results": null,
          "note": "travel"
        },
        {
          "date": "<today-4>",
          "status": "met",
          "results": {
            "wake": 364,
            "light": true
          },
          "note": null
        },
        {
          "date": "<today-5>",
          "status": "partial",
          "results": {
            "wake": 362,
            "light": false
          },
          "note": null
        },
        {
          "date": "<today-6>",
          "status": "met",
          "results": {
            "wake": 364,
            "light": true
          },
          "note": null
        },
        {
          "date": "<today-7>",
          "status": "met",
          "results": {
            "wake": 364,
            "light": true
          },
          "note": null
        }
      ]
    }
  ]
}
```

Every number is pre-rounded so the coach can quote it directly, and each entry carries exactly `date` / `status` / `results` / `note` — the row's own id and timestamps stay server-side, because a day is addressed by `(habit id, date)`.

## 2. All-history scalars vs the window

The property most worth showing: narrowing the window moves `entries`, `hit_rate` and the five counts, and leaves the streaks, `met_days_total` and `stage` exactly where they were. Those are cumulative-forever figures, so anything else would be a wrong number.

```bash
cd frontend
# Boot the app against the in-memory Supabase backend the e2e suite uses — real route
# handler, real Supabase client, no live database.
export MOCK_SUPABASE_PORT=54332 INGEST_API_KEY=demo-ingest-key
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54332 \
       NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock \
       SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
[ -d .next ] || npm run build >/dev/null 2>&1
node scripts/mock-supabase.mjs >/dev/null 2>&1 & MOCK=$!
npm run start -- -p 3011 >/dev/null 2>&1 & APP=$!
# `npm run start` spawns next-server as a child, so kill the child too or it outlives the
# block and holds the port.
cleanup() { pkill -P "$APP" 2>/dev/null; kill "$APP" "$MOCK" 2>/dev/null; }
trap cleanup EXIT
until curl -sf localhost:54332/__mock__/health >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null localhost:3011/login 2>/dev/null; do sleep 0.5; done

KEY="x-api-key: demo-ingest-key"
API=localhost:3011/api/habits
HABIT=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8
ARCHIVED=8c2d1e0f-7a6b-4c5d-9e8f-1a2b3c4d5e6f

# Every date below is relative to whenever this runs, so the captured output masks them back
# to <today> / <today-N>. The doc stays readable and re-verifies on any day.
day() { date -u -d "$1 days ago" +%F; }
mask() { sed $(for n in 0 1 2 3 4 5 6 7 8 89 90 365 366; do printf -- "-e s/%s/<today-%s>/g " "$(day $n)" "$n"; done) -e "s/<today-0>/<today>/g"; }

# The reference habit: up by 6:15 AND outside for light, every day, one forgiven miss per
# rolling week. Seven days of history ending yesterday, today still unlogged — plus an
# archived habit to prove include_archived.
entry() { printf "{\"habit_id\":\"%s\",\"entry_date\":\"%s\",\"status\":\"%s\",\"results\":%s,\"note\":%s}" "$1" "$(day $2)" "$3" "$4" "$5"; }
MET='{"wake":364,"light":true}'
seed() {
cat <<JSON | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- localhost:54332/__mock__/seed >/dev/null
{"habits":[
  {"id":"$HABIT","name":"Morning routine","notes":null,"sort_order":1,"allowance":1,"started_on":"$(day 7)",
   "criteria":[{"key":"wake","label":"Up by 6:15","kind":"time","target":375,"comparator":"lte"},
               {"key":"light","label":"Outside for light","kind":"boolean"}]},
  {"id":"$ARCHIVED","name":"Evening wind-down","notes":null,"sort_order":2,"allowance":0,"started_on":"$(day 7)",
   "archived_at":"$(day 2)T12:00:00Z",
   "criteria":[{"key":"screens","label":"Screens off by 22:30","kind":"time","target":1350,"comparator":"lte"}]}],
 "habitEntries":[
  $(entry "$HABIT" 7 met "$MET" null),
  $(entry "$HABIT" 6 met "$MET" null),
  $(entry "$HABIT" 5 partial '{"wake":362,"light":false}' null),
  $(entry "$HABIT" 4 met "$MET" null),
  $(entry "$HABIT" 3 skipped null '"travel"'),
  $(entry "$HABIT" 2 met "$MET" null),
  $(entry "$HABIT" 1 met "$MET" null),
  $(entry "$ARCHIVED" 5 met '{"screens":1320}' null),
  $(entry "$ARCHIVED" 4 met '{"screens":1340}' null)]}
JSON
}
seed
for w in "from=$(day 7)" "from=$(day 1)"; do
  echo "GET ?tz=UTC&$w"
  curl -sf -H "$KEY" "$API?tz=UTC&$w" | jq -c '.habits[0] | {
    entries: [.entries[].date],
    windowed: {hit_rate: .stats.hit_rate, met: .stats.met, partial: .stats.partial, skipped: .stats.skipped, unknown: .stats.unknown},
    all_history: {current_streak: .stats.current_streak, longest_streak: .stats.longest_streak, met_days_total: .stats.met_days_total, stage: .stats.stage}}'
done | mask
```

```output
GET ?tz=UTC&from=<today-7>
{"entries":["<today-1>","<today-2>","<today-3>","<today-4>","<today-5>","<today-6>","<today-7>"],"windowed":{"hit_rate":0.833,"met":5,"partial":1,"skipped":1,"unknown":1},"all_history":{"current_streak":5,"longest_streak":5,"met_days_total":5,"stage":"fully_deliberate"}}
GET ?tz=UTC&from=<today-1>
{"entries":["<today-1>"],"windowed":{"hit_rate":1,"met":1,"partial":0,"skipped":0,"unknown":1},"all_history":{"current_streak":5,"longest_streak":5,"met_days_total":5,"stage":"fully_deliberate"}}
```

Note the streak reads 5 over a 7-day run: the forgiven `partial` kept the chain alive but was not earned, and the `skipped` day is transparent. `unknown` is today, which has not been logged — it costs allowance but sits on neither side of the hit rate.

## 3. `tz` decides the day boundary — and a bad zone falls back loudly

The response echoes the zone **actually used**, not the one requested, so a caller who sent a typo can see that its days were bucketed in UTC instead of misreading the numbers.

```bash
cd frontend
# Boot the app against the in-memory Supabase backend the e2e suite uses — real route
# handler, real Supabase client, no live database.
export MOCK_SUPABASE_PORT=54332 INGEST_API_KEY=demo-ingest-key
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54332 \
       NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock \
       SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
[ -d .next ] || npm run build >/dev/null 2>&1
node scripts/mock-supabase.mjs >/dev/null 2>&1 & MOCK=$!
npm run start -- -p 3011 >/dev/null 2>&1 & APP=$!
# `npm run start` spawns next-server as a child, so kill the child too or it outlives the
# block and holds the port.
cleanup() { pkill -P "$APP" 2>/dev/null; kill "$APP" "$MOCK" 2>/dev/null; }
trap cleanup EXIT
until curl -sf localhost:54332/__mock__/health >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null localhost:3011/login 2>/dev/null; do sleep 0.5; done

KEY="x-api-key: demo-ingest-key"
API=localhost:3011/api/habits
HABIT=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8
ARCHIVED=8c2d1e0f-7a6b-4c5d-9e8f-1a2b3c4d5e6f

# Every date below is relative to whenever this runs, so the captured output masks them back
# to <today> / <today-N>. The doc stays readable and re-verifies on any day.
day() { date -u -d "$1 days ago" +%F; }
mask() { sed $(for n in 0 1 2 3 4 5 6 7 8 89 90 365 366; do printf -- "-e s/%s/<today-%s>/g " "$(day $n)" "$n"; done) -e "s/<today-0>/<today>/g"; }

# The reference habit: up by 6:15 AND outside for light, every day, one forgiven miss per
# rolling week. Seven days of history ending yesterday, today still unlogged — plus an
# archived habit to prove include_archived.
entry() { printf "{\"habit_id\":\"%s\",\"entry_date\":\"%s\",\"status\":\"%s\",\"results\":%s,\"note\":%s}" "$1" "$(day $2)" "$3" "$4" "$5"; }
MET='{"wake":364,"light":true}'
seed() {
cat <<JSON | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- localhost:54332/__mock__/seed >/dev/null
{"habits":[
  {"id":"$HABIT","name":"Morning routine","notes":null,"sort_order":1,"allowance":1,"started_on":"$(day 7)",
   "criteria":[{"key":"wake","label":"Up by 6:15","kind":"time","target":375,"comparator":"lte"},
               {"key":"light","label":"Outside for light","kind":"boolean"}]},
  {"id":"$ARCHIVED","name":"Evening wind-down","notes":null,"sort_order":2,"allowance":0,"started_on":"$(day 7)",
   "archived_at":"$(day 2)T12:00:00Z",
   "criteria":[{"key":"screens","label":"Screens off by 22:30","kind":"time","target":1350,"comparator":"lte"}]}],
 "habitEntries":[
  $(entry "$HABIT" 7 met "$MET" null),
  $(entry "$HABIT" 6 met "$MET" null),
  $(entry "$HABIT" 5 partial '{"wake":362,"light":false}' null),
  $(entry "$HABIT" 4 met "$MET" null),
  $(entry "$HABIT" 3 skipped null '"travel"'),
  $(entry "$HABIT" 2 met "$MET" null),
  $(entry "$HABIT" 1 met "$MET" null),
  $(entry "$ARCHIVED" 5 met '{"screens":1320}' null),
  $(entry "$ARCHIVED" 4 met '{"screens":1340}' null)]}
JSON
}
seed
for z in UTC Asia/Tokyo Pacific/Kiritimati Pacific/Niue Mars/Olympus_Mons; do
  body=$(curl -sf -H "$KEY" "$API?tz=$z")
  echoed=$(echo "$body" | jq -r .timezone); got=$(echo "$body" | jq -r .today)
  printf 'tz=%-18s -> timezone=%-18s today is the calendar date there: %s\n' "$z" "$echoed" "$([ "$got" = "$(TZ=$echoed date +%F)" ] && echo yes || echo NO)"
done
far=$(curl -sf -H "$KEY" "$API?tz=Pacific/Kiritimati" | jq -r .today)
near=$(curl -sf -H "$KEY" "$API?tz=Pacific/Niue" | jq -r .today)
echo
echo "distinct 'today' across UTC+14 and UTC-11: $(printf '%s\n%s\n' "$far" "$near" | sort -u | wc -l)"
echo "a 'to' in the future clamps back: $(curl -sf -H "$KEY" "$API?tz=UTC&to=2099-01-01" | jq -c .window | mask)"
```

```output
tz=UTC                -> timezone=UTC                today is the calendar date there: yes
tz=Asia/Tokyo         -> timezone=Asia/Tokyo         today is the calendar date there: yes
tz=Pacific/Kiritimati -> timezone=Pacific/Kiritimati today is the calendar date there: yes
tz=Pacific/Niue       -> timezone=Pacific/Niue       today is the calendar date there: yes
tz=Mars/Olympus_Mons  -> timezone=UTC                today is the calendar date there: yes

distinct 'today' across UTC+14 and UTC-11: 2
a 'to' in the future clamps back: {"from":"<today-89>","to":"<today>"}
```

## 4. What gets refused

A contradictory or oversized window is a `400` naming the reason, never a silently trimmed answer; no key at all is a `401`. An empty list is only ever a real "no habits".

```bash
cd frontend
# Boot the app against the in-memory Supabase backend the e2e suite uses — real route
# handler, real Supabase client, no live database.
export MOCK_SUPABASE_PORT=54332 INGEST_API_KEY=demo-ingest-key
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54332 \
       NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock \
       SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
[ -d .next ] || npm run build >/dev/null 2>&1
node scripts/mock-supabase.mjs >/dev/null 2>&1 & MOCK=$!
npm run start -- -p 3011 >/dev/null 2>&1 & APP=$!
# `npm run start` spawns next-server as a child, so kill the child too or it outlives the
# block and holds the port.
cleanup() { pkill -P "$APP" 2>/dev/null; kill "$APP" "$MOCK" 2>/dev/null; }
trap cleanup EXIT
until curl -sf localhost:54332/__mock__/health >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null localhost:3011/login 2>/dev/null; do sleep 0.5; done

KEY="x-api-key: demo-ingest-key"
API=localhost:3011/api/habits
HABIT=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8
ARCHIVED=8c2d1e0f-7a6b-4c5d-9e8f-1a2b3c4d5e6f

# Every date below is relative to whenever this runs, so the captured output masks them back
# to <today> / <today-N>. The doc stays readable and re-verifies on any day.
day() { date -u -d "$1 days ago" +%F; }
mask() { sed $(for n in 0 1 2 3 4 5 6 7 8 89 90 365 366; do printf -- "-e s/%s/<today-%s>/g " "$(day $n)" "$n"; done) -e "s/<today-0>/<today>/g"; }

# The reference habit: up by 6:15 AND outside for light, every day, one forgiven miss per
# rolling week. Seven days of history ending yesterday, today still unlogged — plus an
# archived habit to prove include_archived.
entry() { printf "{\"habit_id\":\"%s\",\"entry_date\":\"%s\",\"status\":\"%s\",\"results\":%s,\"note\":%s}" "$1" "$(day $2)" "$3" "$4" "$5"; }
MET='{"wake":364,"light":true}'
seed() {
cat <<JSON | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- localhost:54332/__mock__/seed >/dev/null
{"habits":[
  {"id":"$HABIT","name":"Morning routine","notes":null,"sort_order":1,"allowance":1,"started_on":"$(day 7)",
   "criteria":[{"key":"wake","label":"Up by 6:15","kind":"time","target":375,"comparator":"lte"},
               {"key":"light","label":"Outside for light","kind":"boolean"}]},
  {"id":"$ARCHIVED","name":"Evening wind-down","notes":null,"sort_order":2,"allowance":0,"started_on":"$(day 7)",
   "archived_at":"$(day 2)T12:00:00Z",
   "criteria":[{"key":"screens","label":"Screens off by 22:30","kind":"time","target":1350,"comparator":"lte"}]}],
 "habitEntries":[
  $(entry "$HABIT" 7 met "$MET" null),
  $(entry "$HABIT" 6 met "$MET" null),
  $(entry "$HABIT" 5 partial '{"wake":362,"light":false}' null),
  $(entry "$HABIT" 4 met "$MET" null),
  $(entry "$HABIT" 3 skipped null '"travel"'),
  $(entry "$HABIT" 2 met "$MET" null),
  $(entry "$HABIT" 1 met "$MET" null),
  $(entry "$ARCHIVED" 5 met '{"screens":1320}' null),
  $(entry "$ARCHIVED" 4 met '{"screens":1340}' null)]}
JSON
}
seed
show() {
  label=$1; shift
  code=$(curl -s -o /tmp/body -w '%{http_code}' "$@")
  printf '%-40s -> %s %s\n' "$label" "$code" "$(jq -c 'if .error then {error, why: (.details[0].message // "—")} else {habits: (.habits|length)} end' /tmp/body)"
}
show 'GET (no key at all)'                 "$API"
show 'GET (wrong key beside a good bearer)' -H 'x-api-key: nope' -H 'Authorization: Bearer demo-ingest-key' "$API"
show 'GET (empty key beside a good bearer)' -H 'x-api-key;'      -H 'Authorization: Bearer demo-ingest-key' "$API"
show 'GET ?from=<today-1>&to=<today-7>'    -H "$KEY" "$API?from=$(day 1)&to=$(day 7)"
show 'GET ?from=<today-400>'               -H "$KEY" "$API?from=$(day 400)"
show 'GET ?from=<today-365>  (366 days)'   -H "$KEY" "$API?from=$(day 365)"
show 'GET ?from=<today-366>  (367 days)'   -H "$KEY" "$API?from=$(day 366)"
show 'GET ?from=not-a-date'                -H "$KEY" "$API?from=not-a-date"
show 'GET ?include_archived=maybe'         -H "$KEY" "$API?include_archived=maybe"
```

```output
GET (no key at all)                      -> 401 {"error":"Unauthorized","why":"—"}
GET (wrong key beside a good bearer)     -> 401 {"error":"Unauthorized","why":"—"}
GET (empty key beside a good bearer)     -> 401 {"error":"Unauthorized","why":"—"}
GET ?from=<today-1>&to=<today-7>         -> 400 {"error":"Invalid query parameters","why":"`from` must not be after `to`"}
GET ?from=<today-400>                    -> 400 {"error":"The window must not exceed 366 days","why":"—"}
GET ?from=<today-365>  (366 days)        -> 200 {"habits":1}
GET ?from=<today-366>  (367 days)        -> 400 {"error":"The window must not exceed 366 days","why":"—"}
GET ?from=not-a-date                     -> 400 {"error":"Invalid query parameters","why":"Invalid ISO date"}
GET ?include_archived=maybe              -> 400 {"error":"Invalid query parameters","why":"Invalid option: expected one of \"true\"|\"false\""}
```

`include_archived=maybe` is a rejection rather than a coercion on purpose: under `Boolean('false')` a caller asking to *exclude* archived habits would silently get the opposite.

## 5. `include_archived`

```bash
cd frontend
# Boot the app against the in-memory Supabase backend the e2e suite uses — real route
# handler, real Supabase client, no live database.
export MOCK_SUPABASE_PORT=54332 INGEST_API_KEY=demo-ingest-key
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54332 \
       NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock \
       SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
[ -d .next ] || npm run build >/dev/null 2>&1
node scripts/mock-supabase.mjs >/dev/null 2>&1 & MOCK=$!
npm run start -- -p 3011 >/dev/null 2>&1 & APP=$!
# `npm run start` spawns next-server as a child, so kill the child too or it outlives the
# block and holds the port.
cleanup() { pkill -P "$APP" 2>/dev/null; kill "$APP" "$MOCK" 2>/dev/null; }
trap cleanup EXIT
until curl -sf localhost:54332/__mock__/health >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null localhost:3011/login 2>/dev/null; do sleep 0.5; done

KEY="x-api-key: demo-ingest-key"
API=localhost:3011/api/habits
HABIT=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8
ARCHIVED=8c2d1e0f-7a6b-4c5d-9e8f-1a2b3c4d5e6f

# Every date below is relative to whenever this runs, so the captured output masks them back
# to <today> / <today-N>. The doc stays readable and re-verifies on any day.
day() { date -u -d "$1 days ago" +%F; }
mask() { sed $(for n in 0 1 2 3 4 5 6 7 8 89 90 365 366; do printf -- "-e s/%s/<today-%s>/g " "$(day $n)" "$n"; done) -e "s/<today-0>/<today>/g"; }

# The reference habit: up by 6:15 AND outside for light, every day, one forgiven miss per
# rolling week. Seven days of history ending yesterday, today still unlogged — plus an
# archived habit to prove include_archived.
entry() { printf "{\"habit_id\":\"%s\",\"entry_date\":\"%s\",\"status\":\"%s\",\"results\":%s,\"note\":%s}" "$1" "$(day $2)" "$3" "$4" "$5"; }
MET='{"wake":364,"light":true}'
seed() {
cat <<JSON | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- localhost:54332/__mock__/seed >/dev/null
{"habits":[
  {"id":"$HABIT","name":"Morning routine","notes":null,"sort_order":1,"allowance":1,"started_on":"$(day 7)",
   "criteria":[{"key":"wake","label":"Up by 6:15","kind":"time","target":375,"comparator":"lte"},
               {"key":"light","label":"Outside for light","kind":"boolean"}]},
  {"id":"$ARCHIVED","name":"Evening wind-down","notes":null,"sort_order":2,"allowance":0,"started_on":"$(day 7)",
   "archived_at":"$(day 2)T12:00:00Z",
   "criteria":[{"key":"screens","label":"Screens off by 22:30","kind":"time","target":1350,"comparator":"lte"}]}],
 "habitEntries":[
  $(entry "$HABIT" 7 met "$MET" null),
  $(entry "$HABIT" 6 met "$MET" null),
  $(entry "$HABIT" 5 partial '{"wake":362,"light":false}' null),
  $(entry "$HABIT" 4 met "$MET" null),
  $(entry "$HABIT" 3 skipped null '"travel"'),
  $(entry "$HABIT" 2 met "$MET" null),
  $(entry "$HABIT" 1 met "$MET" null),
  $(entry "$ARCHIVED" 5 met '{"screens":1320}' null),
  $(entry "$ARCHIVED" 4 met '{"screens":1340}' null)]}
JSON
}
seed
for v in '' '?include_archived=false' '?include_archived=true'; do
  printf '%-28s -> %s\n' "GET ${v:-(default)}" "$(curl -sf -H "$KEY" "$API$v" | jq -c '[.habits[] | {name, archived_at}]')"
done | mask
```

```output
GET (default)                -> [{"name":"Morning routine","archived_at":null}]
GET ?include_archived=false  -> [{"name":"Morning routine","archived_at":null}]
GET ?include_archived=true   -> [{"name":"Morning routine","archived_at":null},{"name":"Evening wind-down","archived_at":"<today-2>T12:00:00Z"}]
```

## 6. The loop the coach actually runs

Read, log the morning it just heard about, read again. The write is `PUT /api/habits/[id]/entries` — shipped earlier, undocumented until now — and it takes **evidence**, not a verdict: the server scores the results and freezes the status it derived.

```bash
cd frontend
# Boot the app against the in-memory Supabase backend the e2e suite uses — real route
# handler, real Supabase client, no live database.
export MOCK_SUPABASE_PORT=54332 INGEST_API_KEY=demo-ingest-key
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54332 \
       NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock \
       SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
[ -d .next ] || npm run build >/dev/null 2>&1
node scripts/mock-supabase.mjs >/dev/null 2>&1 & MOCK=$!
npm run start -- -p 3011 >/dev/null 2>&1 & APP=$!
# `npm run start` spawns next-server as a child, so kill the child too or it outlives the
# block and holds the port.
cleanup() { pkill -P "$APP" 2>/dev/null; kill "$APP" "$MOCK" 2>/dev/null; }
trap cleanup EXIT
until curl -sf localhost:54332/__mock__/health >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null localhost:3011/login 2>/dev/null; do sleep 0.5; done

KEY="x-api-key: demo-ingest-key"
API=localhost:3011/api/habits
HABIT=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8
ARCHIVED=8c2d1e0f-7a6b-4c5d-9e8f-1a2b3c4d5e6f

# Every date below is relative to whenever this runs, so the captured output masks them back
# to <today> / <today-N>. The doc stays readable and re-verifies on any day.
day() { date -u -d "$1 days ago" +%F; }
mask() { sed $(for n in 0 1 2 3 4 5 6 7 8 89 90 365 366; do printf -- "-e s/%s/<today-%s>/g " "$(day $n)" "$n"; done) -e "s/<today-0>/<today>/g"; }

# The reference habit: up by 6:15 AND outside for light, every day, one forgiven miss per
# rolling week. Seven days of history ending yesterday, today still unlogged — plus an
# archived habit to prove include_archived.
entry() { printf "{\"habit_id\":\"%s\",\"entry_date\":\"%s\",\"status\":\"%s\",\"results\":%s,\"note\":%s}" "$1" "$(day $2)" "$3" "$4" "$5"; }
MET='{"wake":364,"light":true}'
seed() {
cat <<JSON | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- localhost:54332/__mock__/seed >/dev/null
{"habits":[
  {"id":"$HABIT","name":"Morning routine","notes":null,"sort_order":1,"allowance":1,"started_on":"$(day 7)",
   "criteria":[{"key":"wake","label":"Up by 6:15","kind":"time","target":375,"comparator":"lte"},
               {"key":"light","label":"Outside for light","kind":"boolean"}]},
  {"id":"$ARCHIVED","name":"Evening wind-down","notes":null,"sort_order":2,"allowance":0,"started_on":"$(day 7)",
   "archived_at":"$(day 2)T12:00:00Z",
   "criteria":[{"key":"screens","label":"Screens off by 22:30","kind":"time","target":1350,"comparator":"lte"}]}],
 "habitEntries":[
  $(entry "$HABIT" 7 met "$MET" null),
  $(entry "$HABIT" 6 met "$MET" null),
  $(entry "$HABIT" 5 partial '{"wake":362,"light":false}' null),
  $(entry "$HABIT" 4 met "$MET" null),
  $(entry "$HABIT" 3 skipped null '"travel"'),
  $(entry "$HABIT" 2 met "$MET" null),
  $(entry "$HABIT" 1 met "$MET" null),
  $(entry "$ARCHIVED" 5 met '{"screens":1320}' null),
  $(entry "$ARCHIVED" 4 met '{"screens":1340}' null)]}
JSON
}
seed
sum() { jq -c '.habits[0].stats | {current_streak, met_days_total, allowance_remaining, unknown}'; }
echo "before: $(curl -sf -H "$KEY" "$API?tz=UTC" | sum)"
echo "PUT:    $(curl -sf -X PUT -H "$KEY" -H 'Content-Type: application/json'   --data '{"tz":"UTC","results":{"wake":360,"light":true}}' "$API/$HABIT/entries"   | jq -c '{entry_date, status, results}' | mask)"
echo "after:  $(curl -sf -H "$KEY" "$API?tz=UTC" | sum)"
echo "newest: $(curl -sf -H "$KEY" "$API?tz=UTC" | jq -c '.habits[0].entries[0]' | mask)"
```

```output
before: {"current_streak":5,"met_days_total":5,"allowance_remaining":0,"unknown":1}
PUT:    {"entry_date":"<today>","status":"met","results":{"wake":360,"light":true}}
after:  {"current_streak":6,"met_days_total":6,"allowance_remaining":0,"unknown":0}
newest: {"date":"<today>","status":"met","results":{"wake":360,"light":true},"note":null}
```

The server derived `met` from `{"wake":360,"light":true}` on its own, today stopped being `unknown`, and the streak moved 5 → 6.

## 7. The primer's reference scripts, run as written

Both scripts are deliverables, so they are pulled straight out of `docs/productivity-coach-primer.md` here — the only edit is filling in the two placeholders the primer tells the reader to fill in.

```bash
cd frontend
# Boot the app against the in-memory Supabase backend the e2e suite uses — real route
# handler, real Supabase client, no live database.
export MOCK_SUPABASE_PORT=54332 INGEST_API_KEY=demo-ingest-key
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54332 \
       NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock \
       SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
[ -d .next ] || npm run build >/dev/null 2>&1
node scripts/mock-supabase.mjs >/dev/null 2>&1 & MOCK=$!
npm run start -- -p 3011 >/dev/null 2>&1 & APP=$!
# `npm run start` spawns next-server as a child, so kill the child too or it outlives the
# block and holds the port.
cleanup() { pkill -P "$APP" 2>/dev/null; kill "$APP" "$MOCK" 2>/dev/null; }
trap cleanup EXIT
until curl -sf localhost:54332/__mock__/health >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null localhost:3011/login 2>/dev/null; do sleep 0.5; done

KEY="x-api-key: demo-ingest-key"
API=localhost:3011/api/habits
HABIT=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8
ARCHIVED=8c2d1e0f-7a6b-4c5d-9e8f-1a2b3c4d5e6f

# Every date below is relative to whenever this runs, so the captured output masks them back
# to <today> / <today-N>. The doc stays readable and re-verifies on any day.
day() { date -u -d "$1 days ago" +%F; }
mask() { sed $(for n in 0 1 2 3 4 5 6 7 8 89 90 365 366; do printf -- "-e s/%s/<today-%s>/g " "$(day $n)" "$n"; done) -e "s/<today-0>/<today>/g"; }

# The reference habit: up by 6:15 AND outside for light, every day, one forgiven miss per
# rolling week. Seven days of history ending yesterday, today still unlogged — plus an
# archived habit to prove include_archived.
entry() { printf "{\"habit_id\":\"%s\",\"entry_date\":\"%s\",\"status\":\"%s\",\"results\":%s,\"note\":%s}" "$1" "$(day $2)" "$3" "$4" "$5"; }
MET='{"wake":364,"light":true}'
seed() {
cat <<JSON | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- localhost:54332/__mock__/seed >/dev/null
{"habits":[
  {"id":"$HABIT","name":"Morning routine","notes":null,"sort_order":1,"allowance":1,"started_on":"$(day 7)",
   "criteria":[{"key":"wake","label":"Up by 6:15","kind":"time","target":375,"comparator":"lte"},
               {"key":"light","label":"Outside for light","kind":"boolean"}]},
  {"id":"$ARCHIVED","name":"Evening wind-down","notes":null,"sort_order":2,"allowance":0,"started_on":"$(day 7)",
   "archived_at":"$(day 2)T12:00:00Z",
   "criteria":[{"key":"screens","label":"Screens off by 22:30","kind":"time","target":1350,"comparator":"lte"}]}],
 "habitEntries":[
  $(entry "$HABIT" 7 met "$MET" null),
  $(entry "$HABIT" 6 met "$MET" null),
  $(entry "$HABIT" 5 partial '{"wake":362,"light":false}' null),
  $(entry "$HABIT" 4 met "$MET" null),
  $(entry "$HABIT" 3 skipped null '"travel"'),
  $(entry "$HABIT" 2 met "$MET" null),
  $(entry "$HABIT" 1 met "$MET" null),
  $(entry "$ARCHIVED" 5 met '{"screens":1320}' null),
  $(entry "$ARCHIVED" 4 met '{"screens":1340}' null)]}
JSON
}
seed
extract() { awk -v tag="\`\`\`bash title=$1" 'index($0, tag)==1{f=1;next} f&&/^```$/{exit} f' ../docs/productivity-coach-primer.md   | sed -e 's#^ALFRED_BASE_URL=.*#ALFRED_BASE_URL="http://localhost:3011"#'         -e 's#^ALFRED_API_KEY=.*#ALFRED_API_KEY="demo-ingest-key"#' > "/tmp/$1"; chmod +x "/tmp/$1"; }
extract habits.sh
extract log-habit.sh

echo 'habits.sh UTC <today-2>'
/tmp/habits.sh UTC "$(day 2)" | jq -c '{window, habit: .habits[0].name, entries: [.habits[0].entries[].date]}' | mask

echo
echo 'log-habit.sh <habit-id> {"wake":371,"light":false} <today-1>'
/tmp/log-habit.sh "$HABIT" '{"wake":371,"light":false}' "$(day 1)" | jq -c '{entry_date, status}' | mask

echo
echo 'log-habit.sh with a day before the habit started — the failure path'
set +e
/tmp/log-habit.sh "$HABIT" '{"wake":360,"light":true}' "$(day 90)"
echo " <- exit $?"
set -e
```

```output
habits.sh UTC <today-2>
{"window":{"from":"<today-2>","to":"<today>"},"habit":"Morning routine","entries":["<today-1>","<today-2>"]}

log-habit.sh <habit-id> {"wake":371,"light":false} <today-1>
{"entry_date":"<today-1>","status":"partial"}

log-habit.sh with a day before the habit started — the failure path
{"error":"Cannot log a day before the habit started"} <- exit 22
curl: (22) The requested URL returned error: 400
```

Wake 06:11 against a 06:15 target passes, but no light does not, so the server scored yesterday `partial` — the caller never stated a status. And a rejected write prints alfred's `error` envelope and exits non-zero, which is what lets the skill report the actual reason.
