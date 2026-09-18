/**
 * A link roundup with no slug link anywhere — the anchor-text fallback.
 *
 * Roundups are mostly outbound links to other people's writing, and this template points at the
 * post itself only through the button at the top. So neither `/p/<slug>` nor `/pub/<name>/p/<slug>`
 * matches anything here and the anchor TEXT is what identifies the post, which is exactly the
 * branch this fixture exists to pin — which also means NO anchor in here may carry a post path,
 * not even one belonging to somebody else's publication: the first-slug-link rule would take it
 * and this branch would never run.
 *
 * The button's URL keeps its query on purpose: `/i/<id>/<token>` is an opaque per-email permalink,
 * and stripping the query leaves a URL that resolves to nothing.
 *
 * The publication, the slug-less permalink and every line of prose are invented.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

/** The invisible padding run, as on every other post mail. */
const PREHEADER_PADDING = '&#847; &nbsp; &#8199; &#173;'.repeat(100);

/** `display:none`, exactly as the template spells it on both preheaders. */
const HIDDEN =
  'display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;';

const HTML = `<!doctype html>
<html lang="en" dir="ltr">
  <head><meta charset="utf-8"><title>Ten links, one argument</title></head>
  <body class="email-body">
    <div class="preview" style="${HIDDEN}">Everything I read this week was, somehow, about scheduling</div>
    <div class="preview" style="${HIDDEN}">${PREHEADER_PADDING}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td style="padding:12px 24px;font-size:12px;color:#888;">
            <a href="https://cadence.substack.com/i/149023188/9f2a?utm_source=email">READ IN APP</a>
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

/** No post path at all; the post is reachable only through the `READ IN APP` anchor's text. */
export const READ_IN_APP_MESSAGE: GmailMessage = {
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
      { name: 'Message-Id', value: '<roundup-1@mail.cadence.substack.com>' },
      { name: 'List-Unsubscribe', value: '<https://cadence.substack.com/action/disable_email>' },
    ],
    parts: [
      {
        mimeType: 'text/html',
        headers: [
          { name: 'Content-Type', value: 'text/html; charset="utf-8"' },
          { name: 'Content-Transfer-Encoding', value: 'quoted-printable' },
        ],
        body: { size: HTML.length, data: encodeBody(HTML) },
      },
    ],
  },
};
