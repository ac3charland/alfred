---
branch: claude/habit-streak-average-calc-wn3amz
---

# Average streak includes the current streak

*2026-08-19T21:22:45.094Z*

`averageStreak` used to count only a habit's ENDED runs, explicitly skipping whatever streak is still in progress. A habit with a single streak going and no completed run yet reported `average_streak: null` — even though it plainly has an average streak length, itself — and the moment a fresh run replaced a broken one, that run's length dropped out of the average entirely until it too ended.

Now the current run counts, at whatever length it has reached so far, the same way `longest_streak` already always included it.

Below: a habit logged met three days running, nothing ever broken. `current_streak` and `longest_streak` already showed 3; `average_streak` used to sit at `null` next to them. It doesn't anymore.

```bash
cd frontend
export MOCK_SUPABASE_PORT=54339 INGEST_API_KEY=demo-ingest-key
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54339 \
       NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock \
       SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
[ -d .next ] || npm run build >/dev/null 2>&1
node scripts/mock-supabase.mjs >/dev/null 2>&1 &
npm run start -- -p 3019 >/dev/null 2>&1 &
# `npm run start` forks next-server two levels down, past what a PID-based kill reaches —
# killing by the ports they're bound to gets every level in one shot.
cleanup() { fuser -k -TERM 54339/tcp 3019/tcp >/dev/null 2>&1; }
trap cleanup EXIT
until curl -sf localhost:54339/__mock__/health >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null localhost:3019/login 2>/dev/null; do sleep 0.5; done

KEY="x-api-key: demo-ingest-key"
API=localhost:3019/api/habits
HABIT=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8
day() { date -u -d "$1 days ago" +%F; }
mask() { sed -e "s/$(day 0)/<today>/g" -e "s/$(day 1)/<today-1>/g" -e "s/$(day 2)/<today-2>/g"; }
pick() { node -e '
let raw = "";
const keep = process.argv[1].split(",");
process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
  const body = JSON.parse(raw);
  const source = body.habits[0];
  const out = {};
  for (const key of keep) out[key] = source[key];
  console.log(JSON.stringify(out, null, 2));
});' "$1"
}

# A habit logged met three days running, nothing ever broken — one streak, still growing.
cat <<JSON | curl -sf -X POST -H "Content-Type: application/json" --data-binary @- localhost:54339/__mock__/seed >/dev/null
{"habits":[{"id":"$HABIT","name":"Morning routine","allowance":1,"started_on":"$(day 2)",
  "criteria":[{"key":"light","label":"Outside for light","kind":"boolean"}]}],
 "habitEntries":[
  {"habit_id":"$HABIT","entry_date":"$(day 2)","status":"met","results":{"light":true},"note":null},
  {"habit_id":"$HABIT","entry_date":"$(day 1)","status":"met","results":{"light":true},"note":null},
  {"habit_id":"$HABIT","entry_date":"$(day 0)","status":"met","results":{"light":true},"note":null}]}
JSON

curl -s "$API?from=$(day 2)" -H "$KEY" | pick stats | mask
```

```output
{
  "stats": {
    "current_streak": 3,
    "longest_streak": 3,
    "average_streak": 3,
    "allowance_remaining": 1,
    "hit_rate": 1,
    "met_days_total": 3,
    "stage": "fully_deliberate",
    "met": 3,
    "partial": 0,
    "missed": 0,
    "skipped": 0,
    "unknown": 0
  }
}
```

`average_streak: 3` next to `current_streak: 3` and `longest_streak: 3` — before this change, that same seed produced `"average_streak": null`.

The other side of the fix — folding a fresh, still-short run in alongside the one that ended before it, so a break shows up in the average instead of vanishing — is exercised directly in `frontend/lib/habits/streaks.test.ts` (e.g. `folds a fresh, still-short run into the average alongside the one it followed`), since it needs a broken chain that's awkward to seed through a single HTTP call.
