---
branch: claude/alf-322-summary-kinds
---

# Reader summary kinds: Essay, Roundup and Alerts

*2026-10-03T18:30:44.817Z*

Each Reader publication now has a summary kind, and the summariser asks each kind a different question: **Essay** (the default — today's prompt, unchanged and still stamped prompt v2), **Roundup** (what's striking in the issue itself, plus the linked pieces worth reading in full) and **Alerts** (only sales, security events, required actions and changes; a post with none is filed to the archive by the tick). Posts render by the kind they were summarised under, so changing a publication's kind rewrites nothing; Retry summary uses the current kind.

## Choosing a kind on /reader/publications

Every publication card carries a kind chip between its provenance badge and its pause toggle. Existing publications read Essay. This is the live app against the mock backend, with one card of each kind and an off-roster bulk sender as a candidate.

![](summary-kinds-image-1.png)

Opening a card's chip lists the three kinds, each with the question it asks; the open chip turns green.

![](summary-kinds-image-2.png)

Picking Roundup saves at once: the chip updates before the PATCH settles, and rolls back with a toast if it fails.

![](summary-kinds-image-3.png)

A candidate's Add is now **Add as ▾**, so a promo sender can't be claimed as an essay on the next tick.

![](summary-kinds-image-4.png)

Added as Alerts: the candidate leaves the list and its card reads Alerts.

![](summary-kinds-image-5.png)

## The reading list by kind

Rows render by the kind they were **summarised under** (`reader_posts.summary_kind`), not by the publication's current kind. An Alerts row shows its findings in place of the gist, one tagged line each (Security in the destructive tone, the rest amber), and has no Send. A Roundup row looks like an Essay row until it's opened.

![](summary-kinds-image-6.png)

A Roundup's overview shows Highlights, then **Links**. Links is the existing Further reading checklist under a new heading, with the same Reader/Instapaper sends and sent marks. The stamp names the kind's prompt: `roundup prompt v1`.

![](summary-kinds-image-7.png)

An Alerts row's Overview holds only the footer: Original, Re-summarise and the stamp.

![](summary-kinds-image-8.png)

When an Alerts post has no findings, the tick sets `archived_at` in the same write as the summary, so the post never reaches the reading list. In the archive it reads like this.

![](summary-kinds-image-9.png)

## What the model is sent, per kind

The tick's writes (kind and per-kind prompt version stamped, auto-archive) are pinned in `workers/src/reader/scheduled.test.ts`. The prompt input has a headless surface: the eval script's dry run prints what the summariser would be shown. With `--kind roundup`, the link-heavy fixture gets its links numbered, as an Essay does today.

```bash
npm run --silent eval:reader -w workers -- --fixtures --dry-run --kind roundup | grep -E '^[a-z-]+$|^  links'
```

```output
essay
  links          4
read-in-app
  links          5
plain-text-only
  links          none
platform-mail
  links          3
reaction-notification
  links          2
link-roundup
  links          8
```

With `--kind alerts`, every fixture sends **no** links block (`links none`): a promo mail is mostly tracking URLs, which would be noise to the judgement. The stored HTML is untouched.

```bash
npm run --silent eval:reader -w workers -- --fixtures --dry-run --kind alerts | grep -E '^[a-z-]+$|^  links'
```

```output
essay
  links          none
read-in-app
  links          none
plain-text-only
  links          none
platform-mail
  links          none
reaction-notification
  links          none
link-roundup
  links          none
```

## Moved snapshot baselines

The three existing publications stories moved by less than the 1% threshold, so the gate couldn't emit a diff. Populated is shown before and after; the two empty-state stories change the same way. Every other existing baseline, including every Essay row, was left untouched. Before:

![](summary-kinds-image-10.png)

After (Populated): the kind chip on each card, and **Add as ▾** on candidates.

![](summary-kinds-image-11.png)
