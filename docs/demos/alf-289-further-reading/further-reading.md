---
branch: alf-265/replay-opus
---

# Further reading: the links a post rests on, ready to send

*2026-10-01T02:59:34.866Z*

A summarised post's overview gains a last section, **Further reading**: the linked sources the model judges worth reading in full, each with a title and a note. Tick some, then send them to the Reader (Instapaper's "To Reader" folder, which the Reader already takes in and summarises) or straight to Instapaper's Unread.

## 1 · The summariser only ever stores URLs the post really contains

The stored text has no URLs, so the summariser now builds the model's input from the post's HTML: each candidate link's number follows its words, and a numbered links block follows the text. A mechanical pre-filter drops only what can never qualify — chrome wrappers, bylines, app links, the post's own address, links with no visible text. Below, the committed link-roundup fixture runs through the real eval script and summariser against a stand-in model that answers with link 5, link 1, a number the post never had (42), and link 1 again. What is stored is two items, mapped to the post's own URLs, deduped, in link order.

```bash
node docs/demos/alf-289-further-reading/roundup-with-stand-in.mjs
```

```output
what the model was shown: the text lines that carry a link marker, then the links block
  The sim-to-real gap in dexterous manipulation [1]
  Why most robotics evals don’t transfer [2]
  FoldBench v2 release notes [3]
  A leaderboard update [4]
  A sceptic’s reply to “scale the simulator” [5]
  the gap paper [1].
  Gridline, the GPU cloud for evals [6].
  
  --- links ---
  [1] https://substack.com/redirect/3f1e0c2a-6b7d-4e58-9a14-2c8d5e7f9b01
  [2] https://substack.com/redirect/7a2b9d4e-1c3f-4a6b-8d05-e9f2c1b4a736
  [3] https://substack.com/redirect/c5d8e1f3-2a4b-4c7d-9e60-1b3a5c7d9e2f
  [4] https://substack.com/redirect/e9b4c2a1-8d6f-4b3e-a705-4f1d2c8e6b93
  [5] https://substack.com/redirect/1d7f3b5c-9e2a-4d8b-b316-7c4e2a9f1d58
  [6] https://substack.com/redirect/88a1b2c3-d4e5-4f60-8a71-b2c3d4e5f607

what the eval printed for it:
link-roundup
  publication    Jonas Kettle from Import Notes
  title          Import Notes 412: three new evals, and a robot that folds
  author         Jonas Kettle from Import Notes
  canonical URL  https://open.substack.com/pub/importnotes/p/import-notes-412
  word count     171
  html_extracted true
  links offered  6
    [1] https://substack.com/redirect/3f1e0c2a-6b7d-4e58-9a14-2c8d5e7f9b01
    [2] https://substack.com/redirect/7a2b9d4e-1c3f-4a6b-8d05-e9f2c1b4a736
    [3] https://substack.com/redirect/c5d8e1f3-2a4b-4c7d-9e60-1b3a5c7d9e2f
    [4] https://substack.com/redirect/e9b4c2a1-8d6f-4b3e-a705-4f1d2c8e6b93
    [5] https://substack.com/redirect/1d7f3b5c-9e2a-4d8b-b316-7c4e2a9f1d58
    [6] https://substack.com/redirect/88a1b2c3-d4e5-4f60-8a71-b2c3d4e5f607
  headline       A roundup worth its links more than itself.
  gist           Mostly restates last week; one new dexterity eval.
  novel ideas
    (none — a restatement)
  evidence
    (none)
  argument       The issue lists the week’s evals.
  who should readRobotics readers, for the links.
  further reading
    - The sim-to-real gap in dexterous manipulation — The paper behind the lead item.
      https://substack.com/redirect/3f1e0c2a-6b7d-4e58-9a14-2c8d5e7f9b01
    - A sceptic’s reply to “scale the simulator” — The best case against the view the author holds.
      https://substack.com/redirect/1d7f3b5c-9e2a-4d8b-b316-7c4e2a9f1d58
  usage          in 900 · out 300 · $0.0048
```

The same pre-filter over every committed fixture, with no model and no key: the links each post's summary may choose from.

```bash
npm run --silent eval:reader -w workers -- --fixtures --dry-run 2>/dev/null | grep -E '^[a-z]|links offered'
```

```output
reader eval — 6 fixtures, extraction only
essay
  links offered  4
read-in-app
  links offered  5
link-roundup
  links offered  6
plain-text-only
  links offered  none
platform-mail
  links offered  3
reaction-notification
  links offered  2
```

## 2 · The section, in its four states

Picking: two links ticked, each row's ↗ opening the link in a new tab beside (not inside) its checkbox, and the bar with Send to Reader, Send to Instapaper and Clear.

![](further-reading-image-1.png)

After sends: a link In Reader, in the Reader's green, and one In Instapaper, muted. Neither can be ticked again; both still open.

![](further-reading-image-2.png)

One send failed: two sent to the Reader, one landed. The landed one is marked, the other stays ticked for a one-press retry, and the toast says what happened.

![](further-reading-image-3.png)

No Instapaper: a deployment without Instapaper credentials can send nowhere, so the section is a plain list of links.

![](further-reading-image-4.png)

These are the committed Storybook baselines (`components/reader/further-reading.stories.tsx`), so the snapshot gate holds them; WikiPicks' baselines are unchanged. A post with no Further reading — including every post summarised under prompt v1 — draws no section at all (`post-overview.test.tsx`), and the Playwright flow `e2e/reader-further-reading.spec.ts` ticks two links on a seeded post, sends them to the Reader with the route stubbed, and sees both marked.
