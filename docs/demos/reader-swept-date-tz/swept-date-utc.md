---
branch: llm-wiki-spike
---

# Swept-post date renders from UTC, not the viewer's local clock

*2026-09-23T17:25:47.074Z*

The reader's swept-post row shows when a post's text was swept, e.g. "Its text was swept on Sep 8". `formatPostDate` (frontend/components/reader/reader-format.ts) parsed the stored UTC ISO timestamp and read it back with local-timezone Date getters (getMonth/getDate/getFullYear), so on a machine west of UTC a timestamp just after UTC midnight rendered as the previous calendar day. The Storybook story below (Reader/PostRow → RefusedAndSwept) uses text_swept_at: 2026-09-08T03:00:00.000Z; shot in a America/Chicago (CDT, UTC-5) browser context, 03:00 UTC is 22:00 the prior day locally.

Before the fix (local-time getters), in CDT the row reads "swept on Sep 7" — one day earlier than the UTC timestamp's date:

![](swept-date-utc-image-1.png)

After the fix (formatPostDate reads getUTC* instead), the same story in the same CDT context correctly reads "swept on Sep 8":

![](swept-date-utc-image-2.png)
