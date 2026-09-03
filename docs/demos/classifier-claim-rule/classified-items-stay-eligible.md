---
branch: claude/llm-classifier-task-code-j8mn1q
---

# Classified and described items still run through the LLM classifier

*2026-09-03T18:38:50.944Z*

Giving a capture a type, or typing a description into it, used to opt it out of the classifier sweep for good. It no longer does: the claim rule is now drawn around the LABELS the classifier writes, the type is locked against the model in the Worker instead, and a decomposed task carries its folder down to its children when it is dispatched.

Everything below runs the REAL shipped sweep (`runSweep` out of `workers/src/sweep.ts`, bundled from source) against a REAL PostgreSQL carrying the REAL migrations, through the harness the classifier's first demo already uses — `docs/demos/llm-inbox-classifier/sweep-harness.mjs`. Only the model's own answer is canned, so the blocks reproduce byte-for-byte.

## 1. Which edits claim the row, and which leave it eligible

One fresh capture, five separate UPDATEs, with `classified_at` read straight after each. The first four are the classifier's INPUT (title, notes) and the field it may not write (`item_type`); the fifth is a label it does write. Then the other label edits, each on an unjudged row of its own.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs claim-rule 2>/dev/null
```

```output
── one unjudged capture, five edits, one UPDATE each ─────────────────────────
  classified_at is read straight after every edit. Null means the sweep may still
  judge the row; set means it is the owner's and the sweeper never revisits.

  the edit                           classified_at            provider
  rewrite the title                  null  → still eligible   null
  add a description                  null  → still eligible   null
  classify it as a task              null  → still eligible   null
  rewrite the title again            null  → still eligible   null
  file it under Family               SET   → claimed          null

  The first four are the classifier's INPUT and its locked field. The fifth is a
  LABEL the classifier writes — that is the one that claims, with no provider,
  because no model produced it.

── the other label edits, each on its own unjudged row ───────────────────────
  the edit                           classified_at            provider
  set a priority                     SET   → claimed          null
  clear its due date                 SET   → claimed          null
  delete its folder                  null  → still eligible   null

  Clearing claims: on an unjudged row the value being emptied can only have come
  from you or from the capture that created it. A folder DELETE does not — it nulls
  folder_id with nobody stating anything, and those are the rows that most need
  re-triaging, so the FK columns claim in the non-null direction only.
```

The row stays on the sweep's side of the line through a rewrite, a description, and the classify itself. Only the folder claims it — and it claims with a **null provider**, which is how a human's answer stays distinguishable from a verdict.

The half of the rule that was already doing real work is untouched: every label still claims in both directions, and the `on delete set null` cascade that returns a deleted folder's items to the Inbox still doesn't.

## 2. A hand-classified row is swept, with its type pinned

The workflow the ticket names: capture "Plan Mom's birthday", classify it `task` from the ⋯ menu so it can hold children, add the two parts under it. Two minutes later the sweep reaches the root. The prompt states the held type and the output schema pins it to that single value — without which a model reading the row as `code` would have every field of its verdict dropped and the row marked anyway.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs typed 2>/dev/null
```

```output
── the row the owner classified by hand, BEFORE the sweep ────────────────────
  title                     Plan Mom's birthday
  item_type                 task                                  ← the owner's answer, set from the ⋯ menu
  priority                  (null)
  due_date                  (null)
  folder_id                 (null)
  intended_project_id       (null)
  intended_epic_id          (null)
  dispatched_at             (null)
  ── provenance ──
  classified_at             (null)                                ← STILL NULL: classifying no longer claims the row
  classified_provider       (null)
  classified_model          (null)
  classified_prompt_version (null)
  classified_guess          (null)
  classify_attempts         0

── runSweep(env, 2026-08-06T02:30:00Z) ───────────────────────────────────────
  {"eligible":2,"classified":2,"failed":0,"aborted":false}
  items sent to the model, in capture order:
    Title: Plan Mom's birthday
    Title: Look into that Rust book everyone keeps mentioning
  (the two subtasks are absent — the sweep selects parent_id is null only)

── the user message for the hand-classified row ──────────────────────────────
  Title: Plan Mom's birthday
  Already classified by the owner: task. This is settled — judge only the fields that apply to a task.

── output_config.format.schema → properties.item_type ────────────────────────
  the hand-classified row — one legal answer, no null branch:
    {
      "enum": [
        "task"
      ]
    }
  the untyped row in the SAME sweep — unchanged:
    {
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
    }

── the row AFTER the sweep ───────────────────────────────────────────────────
  title                     Plan Mom's birthday
  item_type                 task                                  ← still the owner's: the merge never overwrites a held type
  priority                  (null)
  due_date                  (null)
  folder_id                 f0000000-0000-4000-8000-000000000004  (Family)  ← the gap the model filled, which is what makes it dispatch-ready
  intended_project_id       (null)
  intended_epic_id          (null)
  dispatched_at             (null)
  ── provenance ──
  classified_at             2026-08-06T02:30:00Z                  ← the instant the sweep was handed
  classified_provider       anthropic                             ← a model produced this verdict
  classified_model          claude-haiku-4-5
  classified_prompt_version 2
  classified_guess
      { "item_type": "task",
        "folder_id": "f0000000-0000-4000-8000-000000000004" }
  classify_attempts         0
```

The type is still the owner's — `mergeIntoItem` never sends a field the item already holds — and the folder is the gap the model filled, which is what earns the row its dispatch-ready pip. `classified_prompt_version` is 2: the prompt text and the output schema both changed, so the version bumped with them.

The verdict write carries that type as a precondition — `PATCH /rest/v1/items?id=eq.<id>&classified_at=is.null&item_type=eq.task` — so a row re-typed while the request was in flight matches nothing, burns no attempt, and is simply still eligible on the next tick.

## 3. Dispatching the whole subtree, now that one can exist

The consequence that is not in the trigger. A dispatched task must hold a folder (`items_dispatched_needs_folder`, from 0026), the classifier PATCHes one row by id, and dispatch sends every row of the subtree at once — so the children go out folderless. Here they are dispatched CHILD-FIRST, the order the app's parallel PATCHes cannot guarantee.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs subtree 2>/dev/null
```

```output
── after the sweep — the root is filed, the children are not ─────────────────
  title                          folder     dispatched  classified_at
  Plan Mom's birthday            Family     no          set · by the classifier
  Book the restaurant            (none)     no          null
  Order the cake                 (none)     no          null

  Dispatch PATCHes every row of the subtree together, so the order is not the app's
  to choose. Below it is the awkward one: the children go first.

── after the dispatch — every row filed, no CHECK violation ──────────────────
  title                          folder     dispatched  classified_at
  Plan Mom's birthday            Family     yes         set · by the classifier
  Book the restaurant            Family     yes         null
  Order the cake                 Family     yes         null

  The children inherited the ROOT's folder, and neither was claimed on the way: the
  claim trigger sorts before the inheritance trigger, so it sees folder_id still null.
```

And the same three rows on the schema **without** this story's migration, to show the failure the new trigger fixes. The sweep cannot produce this shape there at all — the old rule stamps the row the moment it is classified — so the classifier's write is made by hand and only the dispatch is left to fail.

```bash
node docs/demos/llm-inbox-classifier/sweep-harness.mjs subtree-before 2>/dev/null
```

```output
── the same three rows, on the schema WITHOUT this story's migration ─────────
  title                          folder     dispatched  classified_at
  Plan Mom's birthday            Family     no          set · by the classifier
  Book the restaurant            (none)     no          null
  Order the cake                 (none)     no          null

  Dispatching the first child:
    new row for relation "items" violates check constraint "items_dispatched_needs_folder"

  That is the constraint 0026 added, doing its job: a dispatched task must hold a
  folder, and nothing was cascading the root's down to its children.
```

## What a reviewer can tick off

1. A title rewrite, a description, and a hand-set `item_type` each leave `classified_at` null — the row is still the sweep's to judge (section 1).
2. A folder or a priority set by hand still claims the row, with a null provider, and so does *clearing* a due date — while a folder DELETE, which nulls `folder_id` with nobody stating anything, still does not (section 1).
3. A row the owner typed `task` is selected by `fetchEligibleItems`, is told its type is settled, and has `item_type` pinned to `{ "enum": ["task"] }` — while an untyped row in the same sweep keeps the nullable enum (section 2).
4. The verdict fills the folder and never restates the type; `classified_prompt_version` is 2 (section 2).
5. A decomposed task dispatched child-first files every descendant into the root's folder, and claims none of them (section 3).
6. The same dispatch without the migration fails on `items_dispatched_needs_folder` (section 3).

Not shown, and deliberately: a live model call, and a screenshot. Nothing new renders — the Task badge, the folder chip and the dispatch-ready pip all already exist; what changed is which of them a hand-classified row gets to show, and producing that on screen would need a real sweep against a real model.
