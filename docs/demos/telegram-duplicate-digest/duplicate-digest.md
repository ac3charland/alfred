---
branch: claude/telegram-duplicate-briefings-wf97uc
---

# ALF-345: a timed-out Telegram send is never resent

*2026-11-09T14:14:30.841Z*

On 2026-11-09 the owner got two morning digests, at 7:00 and 7:01, with different openers. The `notifications` row showed why: `attempts: 1`, `last_error: TimeoutError: The operation was aborted due to timeout`, then `sent_at` 07:01 as Telegram message 6 (the day before was 4). Telegram had shown the 7:00 send as message 5, but its reply did not arrive within the Worker's 10 s. The tick read 'no reply' as 'not sent', released the claim, and the 7:01 tick rebuilt the digest and sent it again.

A timeout means the Worker stopped waiting, not that Telegram did nothing. `sendMessage` has no idempotency key and a bot cannot read its own chat, so a send whose result is unknown can never be safely retried. The notify tick now has one rule: **release only what was definitely not shown**. A timeout, network failure, 5xx, or 2xx without a message id is `uncertain`. It counts an attempt, keeps its lease (so `claim_notifications` abandons it, as it already did for a sent ping whose recording failed), and stops the tick, since Telegram is struggling. The send timeout is now 30 s, and the digest goes out at 07:10, off the top of the hour.

The harness (`docs/demos/telegram-duplicate-digest/harness.ts`) runs the shipped tick against the real `claim_notifications` and `digest_facts` on a throwaway PostgreSQL. Telegram is a stand-in phone: the first send is shown and its reply never comes, so the Worker's own abort fires. The 30 s timer is collapsed to zero so the run doesn't wait.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-duplicate-digest/harness.ts 2>/dev/null
```

```output
tick 07:10 — Telegram shows the digest, but its reply never arrives
  summary {"claimed":1,"sent":0,"failed":1,"abandoned":1,"aborted":false}
  failure morning_digest <id>: TimeoutError: The operation was aborted due to timeout — may have been shown, so it is not resent
  phone   #5 Good morning · Wednesday, Jan 15
  row     morning_digest attempts=1 sent=false leased=true  abandoned=false error=TimeoutError: The operation was aborted due to timeout

tick 07:11 — Telegram is answering again; the task due at 7:11 is claimed
  summary {"claimed":1,"sent":1,"failed":0,"abandoned":0,"aborted":false}
  phone   #6 Due 7:11 AM
  row     morning_digest attempts=1 sent=false leased=true  abandoned=false error=TimeoutError: The operation was aborted due to timeout
  row     task_due       attempts=0 sent=true  leased=true  abandoned=false error=-

tick 07:16 — the digest’s five-minute lease has run out
  summary {"claimed":0,"sent":0,"failed":0,"abandoned":0,"aborted":false}
  phone   (nothing new)
  row     morning_digest attempts=1 sent=false leased=true  abandoned=true  error=TimeoutError: The operation was aborted due to timeout
  row     task_due       attempts=0 sent=true  leased=true  abandoned=false error=-

The phone, all morning: 2 messages
  #5 Good morning · Wednesday, Jan 15
  #6 Due 7:11 AM
```

One digest reaches the phone. The 7:11 tick sends the task that came due but leaves the digest alone, because it is still leased. At 7:16 the lease has run out and `claim_notifications` stamps it abandoned. Before this fix, the 7:11 tick would have rebuilt the digest and sent message #6 as a second digest.
