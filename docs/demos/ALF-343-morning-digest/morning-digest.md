---
branch: claude/alf-343-morning-digest-mtv7oj
---

# ALF-343: the 7 AM Telegram morning digest

*2026-11-07T20:35:21.763Z*

Every morning at 7:00 Chicago the one-minute notify tick claims a single `morning_digest` for the local date and sends one Telegram message: a short model-written opener, then the Today view's due list, the ASAP/Today comms queue, and the reader's waiting count. Every count and row is built in code from `digest_facts`; the model writes only the opener.

The texts below are the exact HTML the Worker sends, built by `npm run digest:preview` from the committed fixtures (a real `generate_plan.py` output with invented content) with the opener stubbed. No live Telegram or Anthropic call is made. **Normal** — the opener frames the day; the plan lines it was given are not listed:

```bash
npm run --silent digest:preview -w workers -- normal 2>/dev/null
```

```output
<b>Good morning · Saturday, Nov 7</b>
<i>Long-run day, so the shape is: clear Dana’s rehearsal question first, then finish the RealPlay invoice that slipped Thursday before you head out. The Motivic notes are the week’s Rock 1 thread — an hour this afternoon keeps the win condition in reach.</i>

<b>Due · 5</b>
• Send RealPlay October invoice — <i>2 days late</i>
• Plan Motivic beta — <i>subtask late</i>
• Call the dentist about the crown — 3:00 PM
• Draft Motivic chord-voicing notes
• Pick a post-show bedtime

<b>Comms · 1 ASAP · 2 today · 6 whenever</b>
• ASAP · Dana — Can you confirm Thursday’s rehearsal time?
• Today · Chad — Wants your read on the 2.4 release notes.
• Today · Mom — Asks whether you’re coming Sunday.

<b>Reader · 12 waiting</b>

<a href="https://alfred-six-gamma.vercel.app/today">Today</a> · <a href="https://alfred-six-gamma.vercel.app/comms">Comms</a> · <a href="https://alfred-six-gamma.vercel.app/reader">Reader</a>
```

**Model unavailable** — any opener failure (no key, an SDK error, a refusal, an off-schema reply, a timeout) sends on the same tick with today's week-plan lines in the opener's place, so the plan never silently disappears:

```bash
npm run --silent digest:preview -w workers -- model-unavailable 2>/dev/null
```

```output
<b>Good morning · Saturday, Nov 7</b>

<b>Plan for today</b>
• Run · Long run (8)
• Rock 1 · Draft Motivic chord-voicing notes
• RealPlay · Send RealPlay October invoice

<b>Due · 5</b>
• Send RealPlay October invoice — <i>2 days late</i>
• Plan Motivic beta — <i>subtask late</i>
• Call the dentist about the crown — 3:00 PM
• Draft Motivic chord-voicing notes
• Pick a post-show bedtime

<b>Comms · 1 ASAP · 2 today · 6 whenever</b>
• ASAP · Dana — Can you confirm Thursday’s rehearsal time?
• Today · Chad — Wants your read on the 2.4 release notes.
• Today · Mom — Asks whether you’re coming Sunday.

<b>Reader · 12 waiting</b>

<a href="https://alfred-six-gamma.vercel.app/today">Today</a> · <a href="https://alfred-six-gamma.vercel.app/comms">Comms</a> · <a href="https://alfred-six-gamma.vercel.app/reader">Reader</a>
```

**No plan covers today** — no plan section, and the model is told `plan: null`:

```bash
npm run --silent digest:preview -w workers -- no-plan 2>/dev/null
```

```output
<b>Good morning · Saturday, Nov 7</b>
<i>No week plan covers today, so the list below is the whole picture: the invoice is two days late and Dana is waiting on you — those two first.</i>

<b>Due · 2</b>
• Send RealPlay October invoice — <i>2 days late</i>
• Call the dentist about the crown — 3:00 PM

<b>Comms · 1 ASAP · 0 today · 6 whenever</b>
• ASAP · Dana — Can you confirm Thursday’s rehearsal time?

<b>Reader · 12 waiting</b>

<a href="https://alfred-six-gamma.vercel.app/today">Today</a> · <a href="https://alfred-six-gamma.vercel.app/comms">Comms</a> · <a href="https://alfred-six-gamma.vercel.app/reader">Reader</a>
```

**Quiet day** — it still sends; its arrival is the signal that alfred is alive. The plain-text twin (the fallback when Telegram rejects the HTML) drops the tags and lists the URLs:

```bash
npm run --silent digest:preview -w workers -- quiet 2>/dev/null && echo '--- plain ---' && npm run --silent digest:preview -w workers -- quiet --plain 2>/dev/null
```

```output
<b>Good morning · Sunday, Nov 8</b>
<i>Nothing is due and no one is waiting on you. The plan has today as a rest day — take it.</i>

<b>Due · nothing today</b>

<b>Comms · nothing waiting on you</b>

<b>Reader · 0 waiting</b>

<a href="https://alfred-six-gamma.vercel.app/today">Today</a> · <a href="https://alfred-six-gamma.vercel.app/comms">Comms</a> · <a href="https://alfred-six-gamma.vercel.app/reader">Reader</a>
--- plain ---
Good morning · Sunday, Nov 8
Nothing is due and no one is waiting on you. The plan has today as a rest day — take it.

Due · nothing today

Comms · nothing waiting on you

Reader · 0 waiting

https://alfred-six-gamma.vercel.app/today
https://alfred-six-gamma.vercel.app/comms
https://alfred-six-gamma.vercel.app/reader
```

The tick wiring: DIGEST_TIME parsing, the digest branch, the no-model path, a failed facts read, a retry rebuilding the text, and the per-kind subrequest budget. The claim window, once-per-date, retry/abandon and DST behaviour run against real Postgres in `npm run test:integration -w database` (check:slow).

```bash
npm run --silent test -w workers -- src/notify/tick.test.ts -t 'morning digest' --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const t of JSON.parse(s).testResults[0].assertionResults.filter(a=>a.status!=='pending'))console.log((t.status==='passed'?'✓ ':'✕ ')+t.title)})"
```

```output
✓ passes DIGEST_TIME to the claim, and leaves it out when blank
✓ logs a malformed DIGEST_TIME (7:00), turns the digest off, and still sends the other pings
✓ logs a malformed DIGEST_TIME (24:00), turns the digest off, and still sends the other pings
✓ logs a malformed DIGEST_TIME (07:60), turns the digest off, and still sends the other pings
✓ logs a malformed DIGEST_TIME (07:00:00), turns the digest off, and still sends the other pings
✓ logs a malformed DIGEST_TIME (seven), turns the digest off, and still sends the other pings
✓ reads DIGEST_TIME as HH:MM on a 24-hour clock
✓ builds the digest from the facts and the opener, sends it, and records what was sent
✓ sends the no-model form on the same tick when the opener fails, counting nothing
✓ logs an unreadable plan and still sends, as if no plan covered today
✓ counts a failed facts read as an attempt and sends nothing for it
✓ rebuilds on a retry, so the recorded text is the one that finally went out
✓ starts a digest only when its own worst case (6) still fits the budget
```

The other half of the plan rule: when the newest plan covers today, its lines and theme go **into the model's input** (not the list). This is the exact JSON the opener call is handed for the Normal state — the same capped values the lists render:

```bash
npm run --silent digest:preview -w workers -- normal --opener-input 2>/dev/null
```

```output
{
  "date": "Saturday, Nov 7",
  "plan": {
    "theme": "Finish what slipped & keep the long run",
    "lines": [
      {
        "label": "Run",
        "text": "Long run (8)"
      },
      {
        "label": "Rock 1",
        "text": "Draft Motivic chord-voicing notes"
      },
      {
        "label": "RealPlay",
        "text": "Send RealPlay October invoice"
      }
    ]
  },
  "due": [
    {
      "title": "Send RealPlay October invoice",
      "label": "2 days late"
    },
    {
      "title": "Plan Motivic beta",
      "label": "subtask late"
    },
    {
      "title": "Call the dentist about the crown",
      "label": "3:00 PM"
    },
    {
      "title": "Draft Motivic chord-voicing notes",
      "label": null
    },
    {
      "title": "Pick a post-show bedtime",
      "label": null
    }
  ],
  "due_overflow": 0,
  "comms": {
    "counts": {
      "asap": 1,
      "today": 2,
      "whenever": 6
    },
    "asks": [
      {
        "tier": "asap",
        "sender": "Dana",
        "ask": "Can you confirm Thursday’s rehearsal time?"
      },
      {
        "tier": "today",
        "sender": "Chad",
        "ask": "Wants your read on the 2.4 release notes."
      },
      {
        "tier": "today",
        "sender": "Mom",
        "ask": "Asks whether you’re coming Sunday."
      }
    ]
  },
  "reader_waiting": 12
}
```

**Retries are prompt and at most once** (all ping kinds). A failed send is released with its attempt count, so the 07:00 failure retries at 07:01 rather than 07:05. Claims a tick never reached, or stopped on (429, systemic), are released in one PATCH. The one claim never released is a ping Telegram accepted but that failed to record: its lease runs out and `claim_notifications` abandons it rather than send it twice. The Worker side:

```bash
npm run --silent test -w workers -- src/notify/tick.test.ts -t 'release|429|5xx|401|retried' --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const t of JSON.parse(s).testResults[0].assertionResults.filter(a=>a.status!=='pending'))console.log((t.status==='passed'?'✓ ':'✕ ')+t.title)})"
```

```output
✓ stops at a 429 without counting an attempt, leaving the rest for the next tick
✓ counts a 5xx as an attempt and carries on to the next claim
✓ aborts on a 401 with a banner and counts no attempt
✓ never releases a ping Telegram accepted but that failed to record, so it is never resent
✓ reports a release that fails without throwing
```

The database side runs in `npm run test:integration -w database`: *a leased claim is never re-handed: released, it retries next tick; expired, it is abandoned*, and the 07:00-fail / 07:01-retry digest case.
