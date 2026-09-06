---
branch: claude/alf-191-contextual-dropdowns-k03jvb
---

# ALF-191 — Contextual label dropdowns in the row ⋯ menu

*2026-09-04T01:35:44.906Z*

An Inbox row's metadata chips are editable in place — but only once a field is *set*. So the rows that most need attention (a task with no folder, a code story with no epic) show no affordance at all, and the only way to fill one in was `⋯ → Open details → click the chip → pick → ⋯ → Dispatch`, per row.

This change gives the row's ⋯ menu a set of **type-contextual label submenus** — Due date, Priority, Folder for a task; Project, Epic for a code story — so a row can be made dispatch-ready without ever opening the detail panel. And it retires **Classify as…** the moment a row has a type: a flip after the fields are filled silently drops the ones the new type forbids, so the way back from a wrong type is now Delete and re-capture.

Every shot below is the live app, driven through the Playwright mock backend.

## A task row: Due date · Priority · Folder

The menu on an undispatched task root. The three label submenus sit exactly where Classify as… used to — between the reorder items and Dispatch — and Classify as… is gone, because this row already has a type. Dispatch is dimmed: the row still needs a folder.

![the ⋯ menu on a task row: Due date, Priority and Folder submenus](contextual-label-menus-image-1.png)

**Folder ▸** lists the folders in sidebar order plus "No folder" — the same options, in the same shape, that the row's folder chip popover offers.

![the Folder submenu: No folder, Work, Home](contextual-label-menus-image-2.png)

Picking **Work** writes `folder_id` alone — a *label*, not a move. The row stays in the Inbox, now wearing the folder chip, and the green **Ready to dispatch** pip lights up immediately.

![the row now carries a Work chip and the ready pip, still in the Inbox](contextual-label-menus-image-3.png)

Re-opening the menu: **Dispatch is live**, and Folder ▸ ticks Work in teal — the same trailing check the chip pickers use.

![Dispatch enabled, and Work check-marked in the Folder submenu](contextual-label-menus-image-4.png)

## Due date: presets, not a calendar grid

**Due date ▸** offers Today / Tomorrow / Next week and Custom…. "No due date" is absent while there is no date to clear. (A 7-column grid inside a submenu would break Radix's roving focus — arrows move between menu items, not grid cells — and is a cramped touch target.)

![the Due date submenu with no date set: three presets and Custom…](contextual-label-menus-image-5.png)

**Tomorrow** persists that exact calendar date, and the row picks up its due chip.

![the row wearing a Tomorrow due chip](contextual-label-menus-image-6.png)

Re-opened with a date set, the matching preset carries the tick and **No due date** has appeared above Custom…. The separator stays after the third preset in *both* shapes, so the divider doesn't jump when the clear entry arrives.

The tick is the part that is easy to get wrong: `due_date` is a `timestamptz`, so a reconciled row carries `2026-09-05T00:00:00+00:00`. Compared raw against a `YYYY-MM-DD` preset, no preset would ever tick — the menu normalises the column to its calendar date first.

![Tomorrow check-marked, with No due date now offered](contextual-label-menus-image-7.png)

**Custom…** closes the menu and hands off to the existing Calendar, in a popover anchored to the ⋯ button.

![the Calendar popover anchored under the ⋯ button](contextual-label-menus-image-8.png)

**Priority ▸** is byte-for-byte the chip's own menu: "No priority", a separator, then High / Medium / Low with their chevron glyphs in their accent colours.

![the Priority submenu: No priority, High, Medium, Low](contextual-label-menus-image-9.png)

Dispatch from the same menu files the row into Work. Folder, due date and priority were all set without the detail panel ever opening.

![the row now living in the Work folder](contextual-label-menus-image-10.png)

## A code story: Project · Epic

A childless code root gets a different pair. **Epic ▸** renders disabled until a project is set — and its blocker, *"Pick a project first"*, is drawn as **visible text**, not only a `title`. A disabled Radix sub-trigger is `pointer-events-none`, so it is never a hover target and the browser draws no tooltip at all; on touch there is none to draw either. The `title` stays for assistive tech, and the muted span is for everyone else.

![the code row's menu: Project… above a dimmed Epic… reading 'Pick a project first'](contextual-label-menus-image-11.png)

**Project ▸** lists name left, key right in mono — the gate's own listbox convention, now shared between the chips and the menu by one option builder.

![the Project submenu: No project, Alfred ALF](contextual-label-menus-image-12.png)

With a project set, **Epic ▸** lights up and lists only that project's epics (name left, ref right). Note that setting the project also reset the epic hint to "No epic" — `setIntendedProject` clears both in one PATCH, matching the DB trigger, so a row can never hold an epic from the wrong project.

![the Epic submenu listing Inbox triage ALF-140, with No epic ticked](contextual-label-menus-image-13.png)

## Classify as… is now unclassified-only

An untyped capture still gets **Classify as…** — and nothing else. It has no fields to hang a label on (the detail panel draws no chip row for one either), so one group cleanly replaces the other: the menu carries exactly one of them at any time.

![an unclassified row's menu: Classify as… and no label submenus](contextual-label-menus-image-14.png)

The bulk bar narrows to match. The reasoning is about the *write*, not the surface — `bulkClassify` runs the same `classifyPatch` — so leaving the bar able to re-type a filled row would leave the hole open behind a second door. The moment a typed row joins the selection, **Classify as** disables with its new hint: *"Only unclassified items can be classified"*.

![the bulk bar with a mixed selection: Classify as disabled](contextual-label-menus-image-15.png)

Both journeys above — classify → label → dispatch, for a task and for a code story — run end to end against the in-memory Supabase mock in `frontend/e2e/inbox-labels.spec.ts`. The menu's per-type shape is also snapshot-covered by four new `Tasks/TaskRow` stories, each targeting `body` so the portalled menu actually lands in the baseline.
