---
name: debugging
description: >
  Covers root-cause debugging technique: finding why something is wrong once a first read of the
  code doesn't explain it, across the browser, route handlers, Supabase, Workers and the daemon. Use
  whenever a cause isn't obvious — a bug you can reproduce but not explain, a red CI check, a flaky
  test, a fix that didn't work. Trigger on: "debug", "root cause", "why is this failing", "can't
  figure out", "flaky", "intermittent", "tried everything", "fix didn't work", "CI red", "trace the
  value". Pairs with the bug skill, which owns the bug-fix process; for glitches mid-transition use
  debug-animations.
---

# Debugging

The `bug` skill says what must be true when you're done: reproduced, pinned red, cause fixed. This
skill is **how to find the cause** when reading the code doesn't hand it to you. The same technique
applies to an unexplained red CI check — "flake" is not a root cause.

## Contents

- [The rule](#the-rule)
- [1. Read what you already have](#1-read-what-you-already-have)
- [2. Find where it breaks: instrument the boundaries](#2-find-where-it-breaks-instrument-the-boundaries)
- [3. Compare against something that works](#3-compare-against-something-that-works)
- [4. One hypothesis, one variable](#4-one-hypothesis-one-variable)
- [5. Three failed fixes: stop and question the design](#5-three-failed-fixes-stop-and-question-the-design)
- [Signs you're guessing](#signs-youre-guessing)
- **references/**
  - [root-cause-tracing.md](./references/root-cause-tracing.md) — walk a bad value back up the
    call chain to where it was first wrong; stack-capture instrumentation; finding the test that
    pollutes shared state

## The rule

**No fix before you can say where the wrong value is first wrong, and why.** A patch for a cause you
haven't located is a guess. If it happens to work, you've learned nothing. If it doesn't, you've
added a variable.

## 1. Read what you already have

- Read the whole error and stack trace: file, line, code, the *first* failure and not the last.
  A cascade's later errors are noise.
- Check what changed: `git log -p` on the files involved, `git diff origin/main`, dependency bumps,
  env and config. When "it used to work", `git bisect run <the red test>` finds the commit for you.

## 2. Find where it breaks: instrument the boundaries

alfred's paths cross layers: browser → Next.js route handler → Supabase → Worker → daemon. When
the symptom shows up at the end of that chain, **don't start reading the layer where it appeared.**
Log what enters and what leaves each boundary, run it **once**, and let the output show which hop
first carries a wrong value. Then investigate only that layer.

- Browser ↔ route: the request body and response in Playwright (`page.on('request'|'response')`),
  or `console.error` in the route handler.
- Route ↔ Supabase: the exact query and the rows or error that came back, and which client
  (anon vs service-role) ran it, because RLS turns a permissions bug into "no rows".
- Worker: `wrangler tail` (deployed) or `wrangler dev` stdout, logging the incoming payload and the
  outgoing `fetch`.
- Config propagation: that an env var or secret is *set* in this layer, not just in the one before
  (log `${X:+SET}`, never the value).

Strip the instrumentation before you commit.

## 3. Compare against something that works

Find the nearest working sibling: the other route that does the same thing, the same component in
another story, the commit before the regression. List **every** difference, however small, before
you decide which ones can't matter. The difference you dismissed is usually the bug.

## 4. One hypothesis, one variable

Write down one hypothesis: *"X is the cause because Y."* Test it with the **smallest** change that
could prove it wrong, changing one thing at a time. If it's wrong, revert the probe and form a new
hypothesis. Never stack a second change on a failed first one, or you can't tell which did what.
If you don't understand something, say so to the human rather than patching around it.

## 5. Three failed fixes: stop and question the design

A fix that doesn't work sends you back to step 1 with new evidence. **After three, stop.** If each
fix moved the symptom somewhere else, or the next one needs a sweeping refactor, the problem is the
design, not the latest line. Tell the human what you tried, what each attempt revealed, and the
structural question it raises. Don't attempt a fourth.

"No root cause" (genuinely external, timing, environment) is a rare, *earned* conclusion: say what
you ruled out and how, then handle it explicitly (a retry, a timeout, a clear error message).

## Signs you're guessing

Go back to step 1 when you catch yourself:

- "let me just try changing X and see";
- making several changes, then running the tests;
- proposing a fix before naming the layer where the value goes wrong;
- "it's probably a flake" without a rerun that proves it;
- "one more attempt" after two have failed.
