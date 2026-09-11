---
branch: oneshot-comms-module
---

# Comms: the communication firewall

*2026-09-10T04:00:42.471Z*

ALF-7 builds a third module into alfred: a communication firewall. Every message that arrives on
any of the owner's four accounts is mirrored in, judged once, and shown in one queue that answers
a single question — does the owner owe anyone a reply? Everything below is the built module
driven for real: the screenshots are the live Next app running against the integration suite's
in-memory Supabase backend, seeded and clicked through by Playwright, and the terminal blocks
call the shipped code with pinned inputs so they reproduce byte-for-byte on any machine.

The sections follow the epic's story list: the shell (A), the queue and its two mockups (B, E),
the five row verbs (C), the FYI shelf (D), the three surfaces the owner writes by hand plus the
purge (F), the classifier's prompt and its degradation rules (G), the ingest endpoint and the Mac
daemon (H), and the schema underneath all of it (I).

## A · The module shell

Comms is the third module, not a page inside Tasks — it has its own route group, its own sidebar
and its own segment in the module switcher, which is what turns `isCodePath()` into a real
router. This is `/comms` reached the way the owner reaches it: from the Tasks module, by clicking
the third segment of the switcher. The segment is now current and carries the module's blue
accent, the sidebar has swapped to the Comms nav (Queue, People, Rubric, Examples), and the Queue
link wears the count of what is waiting for a reply — the one number "check comms" collapses to.

![](comms-module-image-1.png)

The same three modules are reachable from the phone-width hamburger, and switching between them
inside the drawer swaps the nav without closing it.

![](comms-module-image-2.png)

## B · The queue on a bad day

The epic's first mockup is a deliberately bad day: every failure surface the module asserts,
drawn at once, because a surface no mockup shows is a surface nobody builds. The app below is
seeded to match it row for row. Three counted tiers and an unbadged, collapsed FYI shelf. ASAP
holds one message from a priority person. Today holds four: a plain question, a photo-only
iMessage from a priority person carrying both the `Priority person` and `Attachment · not read`
chips (queued on who sent it, since alfred could not read it), and a row from
`billing@northwind.co` that nothing judged at all — marked `Unjudged` and treated as owed until
it can be read, because the alternative to a marked row is an invisible one. Whenever holds the
three-week-old row that tier exists for, and one five days from the retention sweep wearing
`Deleted in 5 days`. Every row leads with the ask, never the subject line.

![](comms-module-image-3.png)

The masthead, close up. Three layers, in the order a reader needs them. The blue banner sits
above the dots and is deliberately unlike them: ingestion is healthy and only judgment has
stopped, which is a different fact with a different fix from a dead source. Below it, one dot per
account rather than one per ingestion home — RealPlay is red because its polls are running and
being refused, while WorkMail and iMessage are amber because the Mac they are polled from is
asleep. A coloured dot says something is wrong and never what, so each unhealthy account also
gets a sentence saying what happened and what to do about it.

![](comms-module-image-4.png)

## C · The five verbs, as journeys

A row has five exits, and each one is shown here as the owner performs it: the queue before, the
click, and the queue after. The two clearing verbs look identical on screen and differ only in
what they teach the classifier, so each is followed by the Examples page — the correction log the
prompt draws its few-shot examples from. That page is the only place the difference is visible.

### Expanding a row

Nothing is expanded by default. Clicking a row reveals the message as it arrived, the verdict's
one-sentence `Why:` — the sentence the owner reads when the answer looks wrong — and the five
verbs. Before, then after.

![](comms-module-image-5.png)

![](comms-module-image-6.png)

### Nothing to answer — the demotion

"Nothing to answer" says the row should never have been queued. Dana's ASAP row is expanded, the
verb is pressed, and the row leaves: ASAP drops to 0 and the shelf grows by one.

![](comms-module-image-7.png)

![](comms-module-image-8.png)

And this is why the verb is separate from the one beside it. The Examples page now carries a new
correction for exactly that message — `ASAP → FYI`, tagged `Nothing to answer`, with the
example-set version it was stamped with. That row is what the next classification will be shown.
(The version stamp reads v0 here because the number is assigned by a database trigger that the
in-memory test backend does not run; against real Postgres it is the next set version, as the
seeded examples in section F show.)

![](comms-module-image-9.png)

### Not replying — the exit that teaches nothing

"Not replying" says the verdict was right and the owner is declining anyway. On screen it is
indistinguishable from the verb above: Mom's row leaves Today, which drops from 4 to 3.

![](comms-module-image-10.png)

![](comms-module-image-11.png)

The Examples page after that same action, though, is empty — no correction was recorded, because
nothing about the judgment was wrong. One button could not mean both things.

![](comms-module-image-12.png)

### Change tier — the owner overriding the model

The tier dropdown is the only path back from a false negative, so it is also the correction worth
the most. Marcus's row sits on Whenever; the picker is opened with the current tier ticked, and
Today is chosen.

![](comms-module-image-13.png)

![](comms-module-image-14.png)

The row has moved between sections — Whenever 2 → 1, Today 4 → 5 — and the Examples page has
gained a `Whenever → Today` row tagged `Tier change`.

![](comms-module-image-15.png)

### Make an Inbox item — the third drain path

Some obligations are not replies. "Make an Inbox item" spins the row off into the Tasks module
and clears it, which is the third of the three ways a queued message can leave.

![](comms-module-image-16.png)

![](comms-module-image-17.png)

Priya's row is gone from Today, the toast confirms it, and the Tasks Inbox now holds an item
titled with the ask — not the subject line — with the provenance in its notes.

![](comms-module-image-18.png)

### Open in source

alfred mirrors and never owns, so the message in its own client is always the truth. The verb is
per-client and keyed on what was captured at ingest: an email opens through Apple Mail's
`message:` scheme addressed by the RFC822 Message-ID, so this row's link points at
`message://%3Cq3-invoice-99@realplay.example%3E`, and the E2E suite asserts that exact href
rather than trusting the design doc. An iMessage row shows `Open in Messages` instead (visible in
the keyboard journey below), and a row with no captured Message-ID gets a disabled control that
says why rather than opening Mail to the wrong place.

![](comms-module-image-19.png)

### The keyboard: j, j, n

The module sets the app's first row-level hotkey convention. `j` on a fresh page selects the top
row of the queue as drawn — the ASAP one — and selecting a row expands it.

![](comms-module-image-20.png)

A second `j` walks on into Today's newest row, the photo-only iMessage. Its detail shows what a
body that could not be read looks like from the inside: "No readable text arrived with this
message", the reason it was queued anyway, and `Open in Messages` rather than `Open in Mail`.

![](comms-module-image-21.png)

`n` is "Nothing to answer" on the selected row. It leaves, Today drops from 4 to 3, and the shelf
takes it — the same chain the button fires, because the row wires its hotkeys and its buttons to
the same handlers.

![](comms-module-image-22.png)

## D · The FYI shelf

Everything judged to owe no reply lands on the shelf. It is collapsed and unbadged by choice: a
count here would make it a second queue and the module would have two inboxes again, which is the
exact failure it exists to remove. So it states its size in a sentence and stays shut.

![](comms-module-image-23.png)

Opened, it is legible rather than silent. A message the model declined to judge carries `Refused`
and a message the deterministic header filter shelved before the model ever saw it carries
`Filtered` — two different ways of not being judged, and neither is allowed to look like ordinary
operation. The rows are only mounted once the shelf has been opened, which is what lets it hold
thousands.

![](comms-module-image-24.png)

The shelf is what keeps a false negative recoverable. Promoting the refused row with its tier
picker moves it back into Today (4 → 5, shelf 6 → 5) and un-clears it — a row the owner drags
back into a counted tier is a row they mean to answer, so a promotion that stayed cleared would
be corrected in the example set and still invisible in the queue.

![](comms-module-image-25.png)

## E · The resting state

The epic's second mockup, and the state the module exists to produce — reached by draining, not
by being empty. ASAP and Today at zero, with Today saying so out loud; Whenever still holding the
three-week-old row, because that tier means owed but undated and nothing here ever clears it
except the owner. All four dots green and no banner, because a zero is only worth reading when
nothing is quietly unwatched and nothing has quietly stopped judging. Beneath it, an FYI shelf in
the thousands that does not disturb any of that.

![](comms-module-image-26.png)

## F · People, the rubric, the examples, and the purge

Three surfaces the owner writes by hand, plus the one action that reaches back into them. Each is
driven end to end, because the claims are all server-side: a handle is normalised on the server, a
rubric version is numbered on the server, and the example set's version is stamped by a database
trigger.

### The people list

A person is added with two handles at once — an address typed with stray whitespace and mixed
case, and a phone number typed the way a human types one.

![](comms-module-image-27.png)

What comes back from the server is what the classifier will compare against: `priya@talentco.example`
and `+15550109988`. The same human is a phone number in iMessage and an address in three
mailboxes, and the roster is keyed on the person so the prompt can reason about them as one.

![](comms-module-image-28.png)

Priority is the owner speaking directly to the classifier, and each level says what it buys.

![](comms-module-image-29.png)

Dana drops to Low and her phone number is removed; both survive a reload, so neither was only
optimistic.

![](comms-module-image-30.png)

### The rubric

The rubric is plain-language policy that outranks the model's instincts. Saving an edit writes a
new numbered version and re-judges nothing — every message already judged keeps the verdict it
was given, and the page says so.

![](comms-module-image-31.png)

Old versions stay readable, which is what makes an old verdict answerable months later: a verdict
carries the rubric version it was judged under, and that text is still here.

![](comms-module-image-32.png)

### The example set

Every correction is also a few-shot example. Pruning one takes it out of the prompt without
destroying the record that the owner disagreed — the card stays legible, muted, and stamped with
the set version it left at (`v3 pruned v4`), and the set's own version bumps to v4.

![](comms-module-image-33.png)

Restoring re-admits it: the stamp clears and the set is back to v3.

![](comms-module-image-34.png)

### The purge

Retention already deletes everything after sixty days. The purge is for the messages that should
not wait, and unlike the sweep it reaches into the corrections table and blanks the example text
too — so it asks first, and says exactly what it will and will not touch.

![](comms-module-image-35.png)

One message id, purged, with the count reported back.

![](comms-module-image-36.png)

After a reload the correction is still there — the record that the owner made a judgment call is
the thing worth keeping — but its text is gone: "Purged — the message and its text are gone."
That cascade is the whole difference between the purge and the sweep.

![](comms-module-image-37.png)

## G · The classifier

What the module spends its tokens on is the point, so the evidence here is the prompt itself. The
block below assembles a real request for one evaluation fixture — the shipped `buildCommsRequest`,
the fixture rubric, roster and clock, no model call and no network — and prints the system prompt
and the user message exactly as the Worker would send them. It runs through a small script added
for this doc, `workers/scripts/comms-prompt-demo.ts`; because every input is pinned, the output is
identical on every machine, which is what lets `demo -- verify` police it.

The first fixture is a plain ask from a priority person. Read the system prompt for the four tier
definitions, the recall bias with its direction ("when unsure, queue it and choose today", and
never resolve upward into ASAP), the rule that an ask states what is wanted rather than what the
message is about, and the roster — where Dana is named with her priority and the note explaining
why she matters. Then read the user message: the sender arrives already resolved against that
roster and marked `[priority person]`.

```bash
cd workers && node --import ./scripts/ts-resolve.mjs scripts/comms-prompt-demo.ts blocked-colleague
```

```output
===== blocked-colleague — Someone is blocked on the owner and says so.
----- system -----
alfred is one person's personal task system, and you are the communication firewall inside it. Its owner has four accounts — two Gmail mailboxes, a work mailbox and iMessage — and every message that arrives on any of them is mirrored into alfred, judged once, and shown in one queue. The queue answers exactly one question: does the owner owe anyone anything?

You will be shown exactly one message. Decide the four fields the response schema defines: tier, owes_reply, ask and reason. Answer about this message only.

Nothing you write sends, files, answers or deletes anything — the message stays in Gmail or Messages, and alfred holds a copy. What your answer decides is whether the owner is shown this message at all, and how loudly.

Four tiers:
- asap — Break focus for it. Someone is blocked on the owner, it is time-critical, or the sender is important enough that delay costs something real.
- today — Needs a reply before the owner logs off, but is not worth interrupting for. Most real correspondence lands here.
- whenever — A reply is genuinely owed, but nothing turns on the date. The tier means undated, not unimportant. An invoice to pay, a form to return or a decision requested with a distant due date is whenever, not fyi: it still wants an action.
- fyi — Everything else. No reply owed: newsletters, receipts, confirmations, chatter, thanks-only replies, anything the owner can read later or not at all.

How to choose:
1. Ask first whether the message wants something from the owner — an answer, a decision, an action. That is the entry ticket; urgency only sorts what is already through it.
2. When you are unsure whether a reply is owed, say it is: queue it and choose today. A message wrongly queued costs the owner a glance; a missed obligation costs them the thing they were meant to do.
3. Never choose asap when you are unsure. asap is the only tier that claims "stop what you are doing", so an unearned one makes every future one worth less. asap needs one of two things stated in the message itself: a deadline inside the next few hours, or a named person who cannot continue until the owner acts right now. "By tomorrow", "by end of week", a failed build, a review request or a security prompt with no clock on it are today. If it might be asap but you cannot point to the deadline or the blocked person, it is today.
4. The ask states what the message wants from the owner, and by when — never what it is about. "Dana needs the invoice approved before Friday", never "regarding the Q3 invoice". One line, in the owner's own terms, naming the sender where it helps. A message that wants nothing gets an ask that says so plainly.
5. A message in a group chat is an obligation only when it addresses the owner by name or asks something only they can answer. Ordinary group chatter is fyi however lively it is.
6. When the body reads [image attachment, not read], alfred could not read what was sent and neither can you. Judge on the sender: from someone on the people list below marked as a priority person, choose today and say in the ask that the attachment was not read; from anyone else, choose fyi and say the same.
7. The people list is the owner speaking directly. A priority person who asks anything is at least today. A low-priority person is never asap, however urgent the message sounds — but a real ask from them is still owed: judge it today or whenever on its merits, never fyi for the sender alone.
8. reason is one sentence saying why this tier — the sentence the owner reads when the answer looks wrong. Never rewrite, tidy or summarise the message itself.

The owner's rubric — their own policy, in their own words. It outranks your instincts and everything in the examples below.
The owner is Alex Reyes.
Anything from Priya is asap unless it is plainly chit-chat.
Vendor and sales mail is never urgent, whatever it claims about itself.
Anything about the kids' school needs an answer the same day.
Automated mail that says "do not reply" is fyi even when it names a date.

The owner's people list. A priority person matters because of who they are, whatever the message says; a low-priority person is never urgent however the message reads. Someone absent from this list is not thereby unimportant — the list is only what the owner has got round to writing down.
Priya Reyes (priority person) — +15125550111, priya@mail.example — note: My wife.
Dana Whitfield (priority person) — dana@northwind.example — note: Runs delivery at Northwind; if she is blocked, the release is blocked.
Marcus Feld (normal) — marcus@northwind.example
Trevor Boyd (low priority) — trevor@vendorly.example — note: Vendor account rep. Everything he sends sounds urgent and never is.
Sam Okafor (normal) — +13125550188 — note: Neighbour.
----- user -----
Account: Northwind (gmail)
From: Dana Whitfield <dana@northwind.example> [priority person]
Subject: Migration PR
Received: Wednesday, 2026-09-09 at 09:30
Today is Wednesday, 2026-09-09, in the owner's local time zone — resolve any day or deadline the message names against that.
Message:
I can't ship the release until you approve the migration PR. I'm blocked on it — can you look before the 4pm cut?
```

The second fixture is the same photo-only message the queue shows, but from nobody in particular.
Only the user message is printed, since the system prompt above is identical. A message with no
readable text is classified rather than bypassed: the body is replaced with
`[image attachment, not read]`, which rule 6 above ties to the roster — from a priority person it
is Today with the attachment named in the ask, and from anyone else it is FYI. Most of what a
phone carries is this, and sending each one to a counted tier would leave the owner with a queue
no reply can drain.

```bash
cd workers && node --import ./scripts/ts-resolve.mjs scripts/comms-prompt-demo.ts photo-from-stranger | sed -n '/----- user -----/,$p'
```

```output
----- user -----
Account: iMessage (imessage)
From: +13125559999
Received: Wednesday, 2026-09-09 at 09:30
Today is Wednesday, 2026-09-09, in the owner's local time zone — resolve any day or deadline the message names against that.
Message:
[image attachment, not read]
```

Not every failure means the same thing, so the sweep splits them rather than counting them alike.
A transport failure writes nothing and counts nothing toward the per-message attempt ceiling —
the network being down is not evidence that a message is unjudgeable, and counting it would empty
an outage into a counted tier. A rejected credential or a malformed request aborts the whole tick
without counting anything, because that failure is about the deployment and not about any
message. A refusal is shelved with a visible flag and never retried. A body that never decoded is
parked on Today with no model call at all, because a message alfred cannot read is still a
message someone sent. Each of those is a named case in `workers/src/comms/sweep.test.ts` under
"the failure table" and "the two can't-judge paths" — pinned there rather than pasted here, since
a demo shows new behaviour and the suites already gate the old.

## H · The ingest endpoint and the daemon

The Mac daemon holds no Supabase credential and no Anthropic key. It polls this machine, and
POSTs what it finds to one signed endpoint — so a laptop that goes missing carries a write-only
pipe rather than a key that can read the database. The signature covers a timestamp as well as
the body, which is the difference between a credential that replays forever and one that is
single-use and bound to these exact bytes.

The block below builds a real signed request for a fixed payload and a fixed timestamp using the
Worker's own `hmacSha256Hex`, prints the headers, and then hands all three to the Worker's own
`verifyTimestampedSignature` three times: as sent, with a single byte of the body changed, and
replayed six minutes later. The HMAC is deterministic, so the hex below is the hex you will get.

```bash
cd workers && node --import ./scripts/ts-resolve.mjs --input-type=module -e "
import { hmacSha256Hex, verifyTimestampedSignature } from './src/hmac.ts';

const secret = 'demo-secret-not-the-real-one';
const timestamp = 1788000000;
const now = new Date(timestamp * 1000);
const body = JSON.stringify({
  version: 1,
  account: {
    key: 'imessage',
    kind: 'imessage',
    label: 'iMessage',
    owner_handles: ['+15125550100'],
    expected_interval_seconds: 900,
  },
  heartbeat: { ok: true, cursor: { rowid: 419233 }, error: null },
  messages: [],
});
const signature = 'sha256=' + (await hmacSha256Hex(secret, timestamp + '.' + body));

console.log('POST /comms/ingest');
console.log('Content-Type: application/json');
console.log('X-Alfred-Timestamp: ' + timestamp);
console.log('X-Alfred-Signature: ' + signature);
console.log('');
console.log(body);
console.log('');

const check = async (label, rawBody, sent, at) =>
  console.log(label + ': ' + JSON.stringify(await verifyTimestampedSignature(secret, rawBody, String(sent), signature, at)));

await check('as sent                  ', body, timestamp, now);
await check('body altered by one byte ', body.replace('419233', '419234'), timestamp, now);
await check('replayed six minutes on  ', body, timestamp, new Date(now.getTime() + 6 * 60 * 1000));
"
```

```output
POST /comms/ingest
Content-Type: application/json
X-Alfred-Timestamp: 1788000000
X-Alfred-Signature: sha256=fd31da9bf72b8f595f241e6da2ce96ed5b204fb642931ff3be44fdc4da78640e

{"version":1,"account":{"key":"imessage","kind":"imessage","label":"iMessage","owner_handles":["+15125550100"],"expected_interval_seconds":900},"heartbeat":{"ok":true,"cursor":{"rowid":419233},"error":null},"messages":[]}

as sent                  : {"ok":true}
body altered by one byte : {"ok":false,"reason":"mismatch"}
replayed six minutes on  : {"ok":false,"reason":"stale"}
```

Note the empty `messages` array. A zero-message payload is a first-class request rather than a
degenerate one: the daemon reports liveness about once a minute whether or not anything arrived,
and that heartbeat is the only thing that separates a quiet Mac from a sleeping one — which is
what the amber dots in section B are reading.

The daemon itself is a CLI with four ways to run it.

```bash
npm run --silent start -w daemon -- --help
```

```output
alfred comms daemon — polls this Mac's messages and ships them to alfred.

Usage:
  daemon [options]

Options:
  --once             Poll every enabled source once, then exit.
  --dry-run          Print normalized messages as JSON instead of POSTing them.
  --source <key>     Only run this source (imessage | workmail). Repeatable.
  --check            Run the startup health checks and exit 0 (healthy) or 1 (not).
  --help, -h         Show this help.

With no options it polls every enabled source forever.

Configuration lives at ~/Library/Application Support/alfred-daemon/config.json (override with
ALFRED_DAEMON_CONFIG). Secrets live in the macOS keychain — never in the config, never here.
```

The rest of the daemon's evidence is real-machine and cannot be reproduced by anyone else's
`verify`, so it is recorded here as prose rather than as a command block. On the owner's Mac:
`--check` passed for both sources — config parsed, the ingest HMAC secret was readable from the
login keychain, `chat.db` opened under Full Disk Access, and the IMAP login succeeded with a Sent
folder found. `--once --dry-run --source imessage` emitted **224 messages** over the seven-day
lookback window with **0 decode failures**, every one of them read out of `attributedBody` rather
than the long-empty `message.text` column. `--source workmail` emitted **1** message over the
same window — a quiet week, not a broken poll — with the Sent folder detected **by name**, since
WorkMail does not advertise SPECIAL-USE and imapflow infers the `\Sent` flag from the folder name.
Separately, the Gmail probe (`workers/scripts/gmail-probe.ts`) resolved both OAuth accounts and
found **143** and **3** messages in the same seven days.

Retention is a Worker cron rather than anything the daemon does: `workers/wrangler.toml` schedules
`17 9 * * *` alongside the two-minute classifier tick, and that daily run calls the
`comm_sweep_expired` function shown in the next section, which deletes every mirrored message past
sixty days in any tier. The blanket sweep is why a still-owed row can expire while still owed, and
why the queue puts a `Deleted in N days` marker on any un-drained row inside its last week — the
one in section B's Whenever tier. The marker mitigates and does not prevent: a week of not looking
still loses the row.

## I · The schema

One migration underneath all of the above. Seven tables plus the singleton classifier-health row,
two enums, and the functions the module leans on: the trigger pair that stamps each correction
with the example-set version it was inserted at, the reply recorder that drains a queued row when
its answer shows up, the sixty-day sweep the cron calls, and the purge with its cascade into the
corrections table.

```bash
grep -E '^create (type|table|or replace function)' database/migrations/0034_comms.sql | sed -e 's/($//' -e 's/ *$//'
```

```output
create type comm_tier as enum ('asap', 'today', 'whenever', 'fyi');
create type comm_account_kind as enum ('gmail', 'imap', 'imessage');
create table comm_accounts
create table comm_messages
create table comm_people
create table comm_handles
create table comm_rubrics
create table comm_verdicts
create table comm_corrections
create or replace function comm_example_set_version()
create or replace function comm_corrections_stamp_version()
create table comm_classifier_health
create or replace function comm_record_reply
create or replace function comm_sweep_expired(p_days int default 60)
create or replace function comm_purge
```
