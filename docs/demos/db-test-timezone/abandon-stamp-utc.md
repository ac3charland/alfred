---
branch: claude/db-test-timezone
---

# The abandoned re-run assertion passes in any time zone

*2026-11-16T16:42:21.060Z*

The database integration suite failed on a machine outside UTC: `comms: abandoning a re-run…` read `reclassify_failed_at::text` and expected it to start `2026-09-09 15:01:00`. A bare `::text` renders a `timestamptz` in the session time zone, which for the suite's throwaway local cluster is the machine's own, so a Mac in US Central read `2026-09-09 10:01:00-05` and the pre-push gate failed. CI runs in UTC and never saw it.

The assertion now reads the stamp `at time zone 'utc'`, as the suite's other timestamp read-backs do. The query below shows both renderings of the instant the test writes, in a session set to US Central: the first column is what the assertion read before, the second what it reads now. It selects constants only and touches no table.

```bash
npm run --silent psql -w database -- -At -c "set timezone = 'America/Chicago'" -c "select '2026-09-09T15:01:00.000Z'::timestamptz::text as bare, ('2026-09-09T15:01:00.000Z'::timestamptz at time zone 'utc')::text as in_utc"
```

```output
SET
2026-09-09 10:01:00-05|2026-09-09 15:01:00
```
