---
branch: claude/reader-instapaper-links-bug-7bd8yd
---

# Reader: a "Read on web" link becomes the post's web address (ALF-292)

*2026-09-30T03:23:55.179Z*

A newsletter's link to its own web version was recognised only by a handful of exact wordings ("View in browser", "View this post in your browser", "Read online", "View online", "Read in app"). Mail that labels it any other way, such as "Read on web", Mailchimp's "View this email in your browser", "View it in your browser" or "Web version", came in with no `canonical_url`. So the row's Original link fell back to a Gmail permalink, and Send saved the post to Instapaper as a private email bookmark with no `url`, leaving no link back to the original.

**Before** (base commit `9372104`): of the web-version wordings below, only "View in browser" extracted a URL. Every other one gave `canonical_url: none`, then `Original → mailbox (Gmail permalink)` and `Send → is_private_from_source=email, no url`, which is what the last two guard rows still show. The branch's tests capture that red run: every new wording failed with `Received: undefined` before the fix.

**After:** the extractor (`workers/src/reader/extract.ts`) matches the sentence these links share rather than any single phrasing: a verb (view, read, open), optionally what it acts on (this, it, the email, newsletter, issue…), then where (in a browser, online, on the web, as a web page), plus "web version" and "online version" on their own. "Web" has to end the word, so "Read on the website" and "Read on web.dev" are still not taken. The script runs the real modules end to end: the Worker's `extractPost`, then the frontend's `postOpenLink` (the Original link) and `buildBookmarkParams` (the Send request) over what it stored.

```bash
node docs/demos/reader-web-version-link/evidence.mjs
```

```output
"Read on web"
  canonical_url: https://news.example.com/issues/42?t=abc
  Original → the web version
  Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"Read on the web"
  canonical_url: https://news.example.com/issues/42?t=abc
  Original → the web version
  Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View this email in your browser"
  canonical_url: https://news.example.com/issues/42?t=abc
  Original → the web version
  Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View it in your browser"
  canonical_url: https://news.example.com/issues/42?t=abc
  Original → the web version
  Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View this issue online"
  canonical_url: https://news.example.com/issues/42?t=abc
  Original → the web version
  Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View as a web page"
  canonical_url: https://news.example.com/issues/42?t=abc
  Original → the web version
  Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"Web version"
  canonical_url: https://news.example.com/issues/42?t=abc
  Original → the web version
  Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View in browser"
  canonical_url: https://news.example.com/issues/42?t=abc
  Original → the web version
  Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"Read on the website"
  canonical_url: none
  Original → mailbox (Gmail permalink)
  Send     → is_private_from_source=email, no url · content with 2 links
"Read on web.dev"
  canonical_url: none
  Original → mailbox (Gmail permalink)
  Send     → is_private_from_source=email, no url · content with 2 links
```

Only mail that arrives after this deploys benefits: `canonical_url` is written once at intake, so a post already stored without one keeps its Gmail permalink and its private-bookmark send. The fallback still runs only when the mail carries no `/p/<slug>` link anywhere, and still reads only anchor text in the HTML part (not an image's alt text, and not a plain-text-only mail).
