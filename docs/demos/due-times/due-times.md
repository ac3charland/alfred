---
branch: claude/alf-161-due-times-impl
---

# Due times: a task can be due at 3 PM, not just on a day

*2026-10-03T17:55:15.378Z*

Every screenshot below is the live authenticated app on the Playwright mock backend, in America/Chicago with an en-US locale and the browser clock pinned to Saturday 3 October 2026.

## Setting a time

The detail panel's Due chip opens the due-date picker. Under the grid, a Time row reads **Add time** until a time exists.

![](due-times-image-1.png)

Add time → type 15:00 → Enter. The time saves at once: the panel chip and the row chip both read **Today 3 PM**. The picker stays open, now showing the native time field and a × that clears just the time.

![](due-times-image-2.png)

After a reload the time is still there. It was stored in items.due_time, not just held by the page.

![](due-times-image-3.png)

⋯ → Due date → Custom… opens the same picker, with the same time row.

![](due-times-image-4.png)

## Today, either side of 3 PM

At 14:59:30 the same-day tasks run by time and the untimed one comes last, ahead of its High priority. Call the dentist is amber, both on its chip and on the Errands folder badge.

![](due-times-image-5.png)

One minute later, with no reload, Call the dentist turns red where it stands, and the Errands badge moves from its amber count to its red one. Water the plants is untimed, so it stays amber all day.

![](due-times-image-6.png)

## The database rules

[`db-rules.ts`](db-rules.ts) builds a throwaway Postgres from every committed migration (the integration suite's cluster, so it needs no credentials) and runs each rule as the browser's `authenticated` role.

```bash
node docs/demos/due-times/db-rules.ts 2>/dev/null
```

```output
1. A time with no date is refused:
   new row for relation "items" violates check constraint "items_due_time_needs_date"
2. Moving the date keeps the time; clearing it clears both:
   after a move : {"date":"2026-10-05","time":"15:00:00"}
   after a clear: {"due_date":null,"due_time":null}
3. Sending a timed task to the factory succeeds and drops the time with the date:
   {"item_type":"code","due_date":null,"due_time":null}
4. Completing a recurring timed task spawns the next occurrence at the same time:
   next occurrence: 2026-10-04 at 15:00:00
5. A human time edit claims an unjudged row from the classifier:
   claimed: true
6. Dispatching a row whose guessed time was changed logs a due_time correction:
   {"field":"due_time","direction":"changed","guessed_value":"15:00","chosen_value":"16:30"}
```

## The classifier

[`classifier.ts`](classifier.ts) runs the Worker's real code: the request it builds for a capture, and the parse → validate → merge steps a model answer goes through before it is written. No model is called, because the sandbox has no API key. So this shows what reaches the row for a given answer; it does not show the model producing that answer.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/due-times/classifier.ts 2>/dev/null
```

```output
prompt version 5
system prompt, due_time rule:
  - due_time: answer only when the text states a clock time (“at 3”, “3pm”, “15:30”, “noon”), as 24-hour HH:MM. Never infer a time from a part of day (“tonight”, “this afternoon”, “first thing”) or from urgency. When the text gives a time but names no day, due_date is today. Never answer due_time without a due_date.
schema due_time: {"anyOf":[{"type":"string"},{"type":"null"}]}
due_time required: true

"dentist tomorrow at 3pm"
  answer: {"due_date":"2026-10-04","due_time":"15:00"}
  writes: {"item_type":"task","due_date":"2026-10-04","due_time":"15:00"}
"call mom tonight" (a part of day is not a time)
  answer: {"due_date":"2026-10-03","due_time":null}
  writes: {"item_type":"task","due_date":"2026-10-03"}
a time the model gave with no date
  answer: {"due_date":null,"due_time":"09:30"}
  writes: {"item_type":"task"}
a malformed time
  answer: {"due_date":"2026-10-03","due_time":"5pm"}
  writes: {"item_type":"task","due_date":"2026-10-03"}
a time onto a row already holding that same date
  answer: {"due_date":"2026-10-04","due_time":"15:00"}
  writes: {"item_type":"task","due_time":"15:00"}
a time guessed for a different day than the one the owner set
  answer: {"due_date":"2026-10-04","due_time":"15:00"}
  writes: {"item_type":"task"}
```
