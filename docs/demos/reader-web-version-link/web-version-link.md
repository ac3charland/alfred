---
branch: claude/reader-instapaper-links-bug-7bd8yd
---

# Reader: a "Read on web" link becomes the post's web address (ALF-292)

*2026-09-30T02:57:11.778Z*

A newsletter's link to its own web version was recognised only by a handful of exact wordings ("View in browser", "Read online", "View online", "Read in app"). Mail that labels it "Read on web", or Mailchimp's default "View this email in your browser", came in with no `canonical_url` at all. Two things followed: the row's Original link fell back to a Gmail permalink, and Send saved the post to Instapaper as a private email bookmark with no `url`, so it had no link back to the original.

The fix is in the Worker's extractor (`workers/src/reader/extract.ts`): "web" is taken wherever "online" was, and "email" wherever "post" was, with "web" required to end the word so "Read on the website" still isn't taken. The script below runs the real modules end to end: the Worker's `extractPost` at the commit this branch was cut from (`9372104`) and in the working tree, then the frontend's `postOpenLink` (the Original link) and `buildBookmarkParams` (the Send request) over what each one stored. "View in browser" is the control that already worked, and "Read on the website" is the guard that must stay unmatched.

```bash
node docs/demos/reader-web-version-link/evidence.mjs
```

```output
"Read on web"
  before (9372104)  canonical_url: none
                    Original → mailbox (Gmail permalink)
                    Send     → is_private_from_source=email, no url · content with 2 links
  after (branch)   canonical_url: https://news.example.com/issues/42?t=abc
                    Original → the web version
                    Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"Read on the web"
  before (9372104)  canonical_url: none
                    Original → mailbox (Gmail permalink)
                    Send     → is_private_from_source=email, no url · content with 2 links
  after (branch)   canonical_url: https://news.example.com/issues/42?t=abc
                    Original → the web version
                    Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View on web"
  before (9372104)  canonical_url: none
                    Original → mailbox (Gmail permalink)
                    Send     → is_private_from_source=email, no url · content with 2 links
  after (branch)   canonical_url: https://news.example.com/issues/42?t=abc
                    Original → the web version
                    Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View this email in your browser"
  before (9372104)  canonical_url: none
                    Original → mailbox (Gmail permalink)
                    Send     → is_private_from_source=email, no url · content with 2 links
  after (branch)   canonical_url: https://news.example.com/issues/42?t=abc
                    Original → the web version
                    Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View email in browser"
  before (9372104)  canonical_url: none
                    Original → mailbox (Gmail permalink)
                    Send     → is_private_from_source=email, no url · content with 2 links
  after (branch)   canonical_url: https://news.example.com/issues/42?t=abc
                    Original → the web version
                    Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"View in browser"
  before (9372104)  canonical_url: https://news.example.com/issues/42?t=abc
                    Original → the web version
                    Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
  after (branch)   canonical_url: https://news.example.com/issues/42?t=abc
                    Original → the web version
                    Send     → url=https://news.example.com/issues/42?t=abc · content with 2 links
"Read on the website"
  before (9372104)  canonical_url: none
                    Original → mailbox (Gmail permalink)
                    Send     → is_private_from_source=email, no url · content with 2 links
  after (branch)   canonical_url: none
                    Original → mailbox (Gmail permalink)
                    Send     → is_private_from_source=email, no url · content with 2 links
```

Only mail that arrives after this deploys benefits: `canonical_url` is written once at intake, so a post already stored without one keeps its Gmail permalink and its private-bookmark send.
