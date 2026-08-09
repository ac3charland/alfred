---
branch: claude/llm-classifier-cron-worker-yyanyt
---

# The Inbox classifier: a cron that guesses, a dispatch that teaches it

*2026-08-09T06:23:00.976Z*

The Inbox has always been a pile of raw captures waiting for you to say what each one is. This
change adds a Cloudflare Worker cron (`*/2 * * * *`) that sweeps the items nobody has touched yet,
asks Claude Haiku 4.5 for a schema-constrained verdict about each one, and writes the guesses onto
the item's **real** fields — `item_type`, `priority`, `due_date`, `folder_id`,
`intended_project_id`, `intended_epic_id`. There is no suggestion sidecar, no "proposed" state, and
nothing new on screen: the guesses are just values in the columns the app already reads.

That is only safe because of one thing the sweeper cannot do, and the whole design leans on it:
**it never dispatches**. `dispatched_at` is absent from every payload the sweep writes, by
construction, so an item it has guessed about is still sitting in your Inbox, in the same view,
waiting for you. The worst a bad guess can do is show a wrong label on a row you are already
looking at.

## How this demo runs

This subsystem is genuinely headless — a cron body, a prompt, and a database trigger. There is no
screen to photograph, so its real output is the evidence.

Every block below runs `runSweep` from `workers/src/sweep.ts`, bundled straight out of the Worker
sources by esbuild and imported unmodified, against a throwaway PostgreSQL carrying every migration
in `database/migrations` applied in production order. So the claim trigger, the CHECK constraints
and the dispatch-time diff exercised here are the real ones, not a re-implementation. Supabase's
PostgREST is stood in for by a small `node:http` shim that translates the six request shapes
`workers/src/supabase.ts` actually issues into SQL against that database.

**One thing is not real, and it is the model's own answer.** There is no live Anthropic key in this
environment, and a demo doc has to reproduce byte-for-byte when re-run, so `POST /v1/messages` is
served locally too and replies with a fixed verdict per item. The SDK call, the prompt assembly,
the JSON parse, the validation and the write-back are all shipped code — only what the model says
back is written by hand. No live model call happens anywhere in this document.

The harness is `docs/demos/llm-inbox-classifier/sweep-harness.mjs`; each block names the section of
it that block runs, and every section stands up a fresh database and replays the whole scenario.

## 1. Before the sweep: a capture with no marker on it

Eligibility is deliberately narrow. A row is swept only when it is top-level, still in the Inbox
(`dispatched_at is null`), carries **no classification marker** (`classified_at is null`), and is
under the attempt ceiling. Note the folders being seeded: `Errands` and `Health` carry an
owner-written description, `Reading` does not — that difference shows up in section 3.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs capture 2>/dev/null
```

```output
── the world the model may choose from ───────────────────────────────────────
  folder   Errands    Things that have to happen out in the world: appointments, calls, forms, shop trips.
  folder   Health     Doctors, dentists, prescriptions, exercise: anything to do with the body.
  folder   Reading    (no description)
  project  ALF · alfred
  epic     ALF-4 · Inbox classifier

── items.id = a0000000-0000-4000-8000-000000000001, BEFORE the sweep ─────────
  title                     Call the dentist about the crown — they said to ring back Friday
  item_type                 unclassified                          ← nobody has decided what this is
  priority                  (null)
  due_date                  (null)
  folder_id                 (null)
  intended_project_id       (null)
  intended_epic_id          (null)
  dispatched_at             (null)                                ← still in the Inbox
  ── provenance ──
  classified_at             (null)                                ← no marker, so the sweep is allowed to look at it
  classified_provider       (null)
  classified_model          (null)
  classified_prompt_version (null)
  classified_guess          (null)
  classify_attempts         0
```

`classified_at` — not `item_type` — is the whole eligibility test, and that is on purpose. Keying
on the type would re-ask the same question about the same unjudgeable text on every tick, forever,
burning budget on exactly the items already known to be a bad bet. One marker means the sweeper
sees each capture once.

## 2. One real sweep

`runSweep(env, now)` is the entire body of the cron handler in `workers/src/index.ts`. It is handed
a fixed `now` here so the output is reproducible; in production that is the tick's own clock.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs sweep 2>/dev/null
```

```output
── runSweep(env, 2026-08-06T02:30:00Z) — the real cron body ──────────────────
  {"eligible":2,"classified":2,"failed":0,"aborted":false}

  items the sweep sent to the model, in capture order:
    Title: Call the dentist about the crown — they said to ring back Friday
    Title: Renew the car registration

── items.id = a0000000-0000-4000-8000-000000000001, AFTER the sweep ──────────
  title                     Call the dentist about the crown — they said to ring back Friday
  item_type                 task                                  ← guessed, written onto the real column
  priority                  medium                                ← guessed
  due_date                  2026-08-07                            ← "Friday", resolved against the reference date
  folder_id                 f0000000-0000-4000-8000-000000000001  (Errands)  ← guessed
  intended_project_id       (null)
  intended_epic_id          (null)
  dispatched_at             (null)                                ← STILL NULL: the sweep never dispatches
  ── provenance ──
  classified_at             2026-08-06T02:30:00Z                  ← the instant the sweep was handed
  classified_provider       anthropic                             ← a model produced this verdict
  classified_model          claude-haiku-4-5
  classified_prompt_version 1
  classified_guess
      { "item_type": "task",
        "priority": "medium",
        "due_date": "2026-08-07",
        "folder_id": "f0000000-0000-4000-8000-000000000001" }
  classify_attempts         0
```

The row now holds the model's answers in the columns the app already reads — no badge, no sidecar,
nothing to teach the UI. And `dispatched_at` is **still null**, so the item has not moved: it is
still listed in the Inbox exactly where it was, now with a head start on its own triage. Residency
and location are two different facts (that is what `dispatched_at` was added for), and only a human
act changes residency.

Alongside the guesses sit the six provenance columns. `classified_at` is both "when" and the
idempotency marker. `classified_provider` / `classified_model` / `classified_prompt_version` record
*what* judged it, so a later prompt or model change is a query rather than a migration.
`classify_attempts` is still 0 — it counts failures, not successes. And `classified_guess` keeps the
**post-validation** verdict, not the raw model output, so that the dispatch-time diff in section 5
compares like with like: a field validation dropped was never shown to the owner and must not be
scored as a disagreement. Notice it carries four keys, not six — the two code-only fields are
meaningless on a task, so validation dropped them and they serialise away entirely. Absence is how
this system spells "no opinion", all the way down.

The two items were sent one request at a time, in capture order — deliberately sequential rather
than a parallel burst, so a refusal or a truncation on one item cannot take out the batch.

## 3. The prompt the sweeper actually assembled

This is not a re-derivation: the harness captures the request body the Anthropic SDK put on the
wire and prints its `system` field and its `output_config.format.schema` verbatim.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs prompt 2>/dev/null
```

```output
── the system prompt the sweeper assembled for the dentist item ──────────────
  You are alfred's Inbox classifier. For the one captured item below, decide the six fields the response schema defines: item_type, priority, due_date, folder_id, intended_project_id, and intended_epic_id. Every field may be null — null is always a legal answer, and often the correct one.

  Today is Wednesday, 2026-08-05, in the owner's local time zone. Resolve any relative day or date the text names against this date — never against anything else.

  Abstain rather than guess. Optimise for precision and accept low recall:
  - item_type: answer only when the text clearly reads as a task, or as work on alfred itself. It may stay null.
  - due_date: answer only when the text actually states a date or a day. Never infer it from urgency.
  - priority: answer only when the text itself signals it. No default guess.
  - folder_id: answer only when exactly one existing folder is a clear fit. Never invent a folder.
  - intended_project_id and intended_epic_id: answer only from the sets supplied below. Never invent either.

  Never rewrite, tidy, or summarise the captured text. You are writing metadata only.

  Folders (choose at most one, by id):
  f0000000-0000-4000-8000-000000000001  Errands — Things that have to happen out in the world: appointments, calls, forms, shop trips.
  f0000000-0000-4000-8000-000000000002  Health — Doctors, dentists, prescriptions, exercise: anything to do with the body.
  f0000000-0000-4000-8000-000000000003  Reading

  Projects (choose at most one, by id):
  70000000-0000-4000-8000-000000000001  ALF · alfred — The task app itself: its schema, its frontend, its workers.

  Epics (choose at most one, by id):
  e0000000-0000-4000-8000-000000000001  ALF-4 · Inbox classifier

── the user message ──────────────────────────────────────────────────────────
  Title: Call the dentist about the crown — they said to ring back Friday

── output_config.format.schema — rebuilt this sweep from the live ids ────────
  {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "item_type",
      "priority",
      "due_date",
      "folder_id",
      "intended_project_id",
      "intended_epic_id"
    ],
    "properties": {
      "item_type": {
        "anyOf": [
          {
            "enum": [
              "task",
              "code"
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "priority": {
        "anyOf": [
          {
            "enum": [
              "high",
              "medium",
              "low"
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "due_date": {
        "anyOf": [
          {
            "type": "string",
            "format": "date"
          },
          {
            "type": "null"
          }
        ]
      },
      "folder_id": {
        "anyOf": [
          {
            "enum": [
              "f0000000-0000-4000-8000-000000000001",
              "f0000000-0000-4000-8000-000000000002",
              "f0000000-0000-4000-8000-000000000003"
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "intended_project_id": {
        "anyOf": [
          {
            "enum": [
              "70000000-0000-4000-8000-000000000001"
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "intended_epic_id": {
        "anyOf": [
          {
            "enum": [
              "e0000000-0000-4000-8000-000000000001"
            ]
          },
          {
            "type": "null"
          }
        ]
      }
    }
  }
```

Four things in there are worth a reviewer's attention.

**Descriptions do the discriminating.** `Errands` and `Health` render as `<id>  <name> — <description>`,
because their owner wrote a sentence saying what belongs in them. `Reading` renders its name alone:
no dash, no "(no description)" placeholder. Either of those would read as the model's opinion about
a folder rather than the owner's silence about it, and an undescribed folder should compete on its
name alone.

**The reference date is resolved in code, in the owner's zone, and handed over as an absolute.** The
sweep instant is `2026-08-06T02:30:00Z`, which in `America/Chicago` is still 21:30 the previous
evening — so the prompt says **Wednesday, 2026-08-05**, not Thursday the 6th. The model is never
asked what day it is; it is told, and asked to resolve "Friday" against that. Which it does: the
verdict in section 2 came back `2026-08-07`.

**The output schema is rebuilt every sweep from the live ids.** `folder_id`, `intended_project_id`
and `intended_epic_id` are `enum`s of the exact uuids that existed when the prompt was assembled, so
a hallucinated folder id is not a failure mode the caller has to defend against — it is not a token
the model is offered. (An empty list would collapse to a bare `{ "type": "null" }` rather than an
illegal empty `enum`, which is what a fresh database with no folders yet needs.)

**Every field has a `null` branch, and the prompt says so twice.** Abstention is a first-class
answer. A blank field is one the owner was going to fill in anyway — zero regression — while a
confident wrong label is worse than nothing, because a row that looks finished gets skimmed past.
So the prompt optimises for precision and accepts low recall.

## 4. A human touch claims the item away from the sweeper

The rule: editing any field the classifier writes means the item is yours, and the sweeper never
revisits it. It is enforced by a `before update` trigger in the database rather than in the PATCH
route, because three different ingresses already edit an item and only the database sits under all
of them.

Here, the only thing done to this item was a human adding notes to it — and then the same sweep
from section 2 ran over the whole Inbox.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs claim 2>/dev/null
```

```output
── items.id = a0000000-0000-4000-8000-000000000003 — edited by hand, then swept
  The only change a human made was adding notes; the sweep then ran over the Inbox.

  title                     Look into that Rust book everyone keeps mentioning
  item_type                 unclassified                          ← untouched: no model ever saw this row
  priority                  (null)
  due_date                  (null)
  folder_id                 (null)
  intended_project_id       (null)
  intended_epic_id          (null)
  dispatched_at             (null)
  ── provenance ──
  classified_at             not null                              ← stamped by the claim trigger, not by a sweep
  classified_provider       (null)                                ← null provider = NO MODEL RAN
  classified_model          (null)
  classified_prompt_version (null)
  classified_guess          (null)
  classify_attempts         0

  the sweep asked the model about:
    Title: Call the dentist about the crown — they said to ring back Friday
    Title: Renew the car registration
  (this item is absent — a claimed row drops out of the sweep predicate for good)
```

`classified_at` is stamped, so the row is out of the sweep predicate — and the sweep did in fact
skip it: only the other two captures were sent to the model. But the provenance columns stay **null**,
and that is the point of storing the provider in a column rather than assuming it. A non-null
`classified_at` with a null `classified_provider` means *no model ran* — a human claimed this row
before the sweeper reached it. The two are never confusable, and nothing has to guess.

(`classified_at` is printed as `not null` here rather than as a value: the claim trigger stamps
`now()`, and a wall-clock time in a captured block would make this doc fail its own `verify`.)

## 5. Dispatch is where the learning happens

Dispatch is the one unambiguous "these labels are final" event in the whole system — an edit
mid-triage may be revised twice before you are done, and logging each would teach the model your
hesitation rather than your conclusion. So the diff lives on the `dispatched_at is null → not null`
transition, which is the single choke point all three dispatch paths pass through, and it compares
the stored `classified_guess` against the row as it now stands.

Two items are dispatched below, with three disagreements between them.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs corrections 2>/dev/null
```

```output
── what the owner did at dispatch ────────────────────────────────────────────
  "Call the dentist about the crown — they said to ring back Friday"
     folder   Errands  →  Health        (the model picked the wrong one)
     priority medium   →  (cleared)     (the model should have abstained)
     due date 2026-08-07 kept, item type task kept — no disagreement, no row
  "Renew the car registration"
     priority (blank)  →  high          (the model could have known)

── the dentist item after dispatch ───────────────────────────────────────────
  title                     Call the dentist about the crown — they said to ring back Friday
  item_type                 task
  priority                  (null)                                ← the owner cleared it
  due_date                  2026-08-07
  folder_id                 f0000000-0000-4000-8000-000000000002  (Health)  ← the owner's answer, not the guess
  intended_project_id       (null)
  intended_epic_id          (null)
  dispatched_at             not null                              ← a human act; it has left the Inbox
  ── provenance ──
  classified_at             2026-08-06T02:30:00Z
  classified_provider       anthropic
  classified_model          claude-haiku-4-5
  classified_prompt_version 1
  classified_guess          ← the guess is kept, so the diff has something to compare
      { "item_type": "task",
        "priority": "medium",
        "due_date": "2026-08-07",
        "folder_id": "f0000000-0000-4000-8000-000000000001" }
  classify_attempts         0

── classification_corrections — appended by the dispatch trigger ─────────────
  changed    folder_id
    captured  "Call the dentist about the crown — they said to ring back Friday"
    guessed   f0000000-0000-4000-8000-000000000001
    chosen    f0000000-0000-4000-8000-000000000002
    stamped   anthropic / claude-haiku-4-5 / prompt v1

  blanked    priority
    captured  "Call the dentist about the crown — they said to ring back Friday"
    guessed   medium
    chosen    (none)
    stamped   anthropic / claude-haiku-4-5 / prompt v1

  filled_in  priority
    captured  "Renew the car registration"
    guessed   (none)
    chosen    high
    stamped   anthropic / claude-haiku-4-5 / prompt v1

  3 rows, 3 distinct directions
```

One row per disagreeing field, and all three directions are represented:

- `changed` — the label was wrong. The model filed the dentist call under `Errands`; the owner
  moved it to `Health`.
- `blanked` — the model filled a field the owner then cleared. It guessed `medium` priority off a
  capture that never signalled one. This is the most valuable of the three, because precision is
  exactly what the prompt optimises for and this is the failure it is trying to avoid.
- `filled_in` — the model left a field blank that the owner did fill. It abstained on the car
  registration's priority; the owner said `high`. It could have known.

Fields the two sides agreed on produce no row at all: the item type and the due date on the dentist
call were both kept, so neither is logged.

Each row freezes a copy of the captured text rather than referencing the item, on purpose. A
correction is a historical fact — *this text, at that moment, got that label* — so pointing at the
item would lose the text when the item is deleted, and would pair a later-edited title with a label
chosen for the old one. Each row also carries the provider, model and prompt version that produced
the guess, so a lesson learned under one prompt is still attributable after the prompt changes.

Note also what dispatch did *not* disturb: `classified_guess` is still on the row. It is written
once and read by exactly one consumer — this trigger.

## 6. The next sweep reads the corrections back as worked examples

That is the loop closing. The next tick fetches the recent corrections and renders them into the
system prompt as few-shot examples.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs learn 2>/dev/null
```

```output
── runSweep(env, 2026-08-06T03:15:00Z) — the next tick ───────────────────────
  {"eligible":1,"classified":1,"failed":0,"aborted":false}

── the few-shot block the next prompt now carries ────────────────────────────
  Examples of past corrections — captured text, field, what was guessed, what you chose:

  Captured: "Call the dentist about the crown — they said to ring back Friday"
  Field: priority
  Guessed: medium
  Chosen: none

  Captured: "Call the dentist about the crown — they said to ring back Friday"
  Field: folder_id
  Guessed: Errands
  Chosen: Health

  Captured: "Renew the car registration"
  Field: priority
  Guessed: none
  Chosen: high

── the same ids, unresolved, as the log stores them ──────────────────────────
  folder_id (changed)
    guessed_value  f0000000-0000-4000-8000-000000000001
    chosen_value   f0000000-0000-4000-8000-000000000002
```

The `folder_id` example teaches **"Guessed: Errands / Chosen: Health"** — human names, not the uuids
the log actually stores (printed underneath for comparison). Resolution happens at prompt-assembly
time against the *live* world, which is what makes the log safe to keep forever: an example naming a
folder that has since been deleted simply fails to resolve and is dropped rather than taught, and it
is dropped **before** the draw so it never costs a slot a usable example could have filled.

The order is not recency. The examples are drawn round-robin across the three directions —
`blanked`, then `changed`, then `filled_in`. A log dominated by "you left this blank and I filled it
in" would nudge the model toward guessing more, which is the exact failure abstention exists to
prevent, so the draw deliberately keeps the `blanked` lessons in view.

The tick also shows the eligibility rules composing: one item eligible, not four. The two dispatched
items are gone from the Inbox, the human-claimed one is out for good, and the only thing left is the
capture made after the dispatch.

## What a reviewer can tick off

1. An Inbox item before the sweep — unclassified, unmarked, eligible (section 1).
2. A real `runSweep` against a real migrated Postgres, and the same row afterwards carrying its
   guesses plus all six provenance columns, still `dispatched_at is null` (section 2).
3. The prompt as sent: a described folder rendering its description, an undescribed one rendering
   its name alone, the reference date resolved in `America/Chicago`, and the output schema's enums
   carrying the live ids (section 3).
4. The claim rule: a human edit stamps `classified_at` and leaves `classified_provider` null, and
   the sweep skips the row (section 4).
5. A dispatch with overridden labels, and one `classification_corrections` row per disagreement
   across all three directions (section 5).
6. The next sweep's prompt carrying those corrections as worked examples, with ids resolved to
   names (section 6).

Not shown, and deliberately: a live model call. Everything else above is the shipped code.
