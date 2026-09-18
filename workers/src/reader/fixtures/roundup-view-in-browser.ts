/**
 * A link roundup with no `/p/` link anywhere — the fallback path.
 *
 * Roundups are mostly outbound links to other people's writing, and Substack's roundup template
 * points at the post itself only through the "View this post in your browser" line at the top.
 * So the `^/p/<slug>` rule finds nothing here and the anchor TEXT is what identifies the post,
 * which is exactly the branch this fixture exists to pin — which also means NO anchor in here may
 * carry a `/p/` path, not even one belonging to somebody else's publication: the first-`/p/`-link
 * rule would take it and this branch would never run.
 *
 * The view-in-browser link is on the publication's own `substack.com` host while several outbound
 * links are not, so a host-based rule would still find the right one here; the extractor keys on the PATH
 * because the essay fixture is where a host-based rule breaks, and one rule serves both.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

const HTML = `<!doctype html>
<html>
  <head><title>Ten links, one argument</title></head>
  <body>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td style="padding:12px 24px;font-size:12px;color:#888;">
            <a href="https://cadence.substack.com/i/149023188/9f2a?utm_source=email">View this post in your browser</a>
          </td></tr>
          <tr><td style="padding:0 24px;">
            <h1>Ten links, one argument</h1>
            <p style="color:#888;font-size:13px;">The Cadence Weekly &middot; Friday roundup</p>
            <img src="https://substackcdn.com/image/fetch/cadence-banner.png" alt="The Cadence Weekly banner" width="552" />
            <p>This week everything I read was, somehow, about scheduling.</p>
            <ol>
              <li><a href="https://lateralnotes.example.com/2026/09/the-queue-is-the-product">The queue is the product</a>
                &mdash; the best thing written on backpressure this year, and it never uses the word.</li>
              <li><a href="https://portstudies.example.org/2026/09/berth-occupancy">Berth occupancy as a public good</a>
                &mdash; dry, and worth it for the appendix alone.</li>
              <li><a href="https://slackwater.example.net/essays/against-the-sprint">Against the sprint</a>
                &mdash; I disagree with about half of this and could not put it down.</li>
            </ol>
            <p>Next week: why every rota eventually becomes a seniority ladder.</p>
          </td></tr>
          <tr><td style="padding:24px;border-top:1px solid #eee;font-size:12px;color:#888;">
            <p><strong>Share this post</strong> &mdash;
              <a href="https://cadence.substack.com/subscribe">Subscribe</a> &middot;
              <a href="https://cadence.substack.com/action/disable_email">Unsubscribe</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

/** No `/p/` link at all; the post is reachable only through the "view in browser" anchor. */
export const ROUNDUP_VIEW_IN_BROWSER_MESSAGE: GmailMessage = {
  id: 'gmail-roundup-1',
  threadId: 'thread-roundup-1',
  labelIds: ['INBOX', 'CATEGORY_UPDATES'],
  internalDate: '1789003600000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'The Cadence Weekly <cadence@substack.com>' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Subject', value: 'Ten links, one argument' },
      { name: 'Date', value: 'Tue, 16 Sep 2026 12:06:40 +0000' },
      { name: 'Message-ID', value: '<roundup-1@mail.cadence.substack.com>' },
      { name: 'List-Unsubscribe', value: '<https://cadence.substack.com/action/disable_email>' },
    ],
    parts: [
      {
        mimeType: 'text/html; charset="UTF-8"',
        body: { size: HTML.length, data: encodeBody(HTML) },
      },
    ],
  },
};
