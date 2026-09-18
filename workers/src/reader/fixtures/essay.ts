/**
 * The ordinary case: a long Substack essay, `multipart/alternative`, with a real post link.
 *
 * Everything the extractor has to get right is in here on purpose. The FIRST two anchors are a
 * `javascript:` bookmarklet and a `mailto:` share link, both of which sit AHEAD of the post link
 * and both of which the scheme filter must refuse — the value ends up in an `href` the owner
 * clicks, so treating either as the canonical URL would be a security bug, not a cosmetic one.
 * The post link itself carries the tracking query Substack appends, which is stripped. The
 * publication mails from `<publication>@substack.com` — the shape the discovery view matches —
 * with a display name in `From`, so the author comes from the header rather than from the roster,
 * and `harborline.substack.com` is what the roster row's domain is derived from.
 *
 * The publication is invented, as is every address: nothing personal appears in any fixture.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

const HTML = `<!doctype html>
<html>
  <head><title>Harborline — The Grain Ledger</title></head>
  <body style="margin:0;padding:0;background:#f4f4f4;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td style="padding:16px 24px;font-size:12px;color:#777;">
            <a href="javascript:void(0)">Save this post</a> &middot;
            <a href="mailto:friend@example.org?subject=Harborline">Email a friend</a>
          </td></tr>
          <tr><td style="padding:0 24px;">
            <h1 style="font-size:28px;line-height:1.2;">The Grain Ledger</h1>
            <p style="color:#777;font-size:13px;">Mira Vantz &middot; Harborline &middot; 14 min read</p>
            <img src="https://substackcdn.com/image/fetch/harborline-hero.png"
                 alt="A grain elevator at dusk, seen from the rail siding" width="552" />
            <p>Every port keeps two sets of books. The first is the one the harbour master signs:
              tonnes in, tonnes out, a stamp, a date. The second is the one the elevator operators
              keep in their heads &mdash; which berths silt up in August, whose barges run light,
              which inspector will wave through a load that is 2% over moisture.</p>
            <p>For a century the second ledger was the valuable one, and it was unwritable. That is
              what has changed. Three port authorities have now published their berth-occupancy
              telemetry as an open feed, and within eighteen months the spread between a
              well-routed cargo and a badly-routed one narrowed from about $4.10 a tonne to $1.30.</p>
            <blockquote>&ldquo;We did not make anyone smarter,&rdquo; the Rotterdam programme lead
              told me. &ldquo;We made it impossible to be the only person in the room who knew.&rdquo;</blockquote>
            <p>The counter-argument is the obvious one, and it is not wrong: the operators who held
              the second ledger were paid for holding it, and a great many of them are now paid
              less. But the tonnage moved per berth-hour is up 11% across the three ports, and the
              waiting-time distribution has lost its long right tail entirely.</p>
            <p>What I cannot yet tell you is whether this survives contact with a bad year. Every
              one of these eighteen months has been a calm-weather month with slack capacity.</p>
            <p><a href="https://harborline.substack.com/p/the-grain-ledger?utm_source=substack&amp;utm_medium=email#footnotes">Read
              the full post with footnotes</a></p>
          </td></tr>
          <tr><td style="padding:24px;border-top:1px solid #e4e4e4;font-size:12px;color:#777;">
            <p><strong>Share this post</strong> &mdash;
              <a href="https://harborline.substack.com/p/the-grain-ledger?action=share">Share</a> &middot;
              <a href="https://harborline.substack.com/p/the-grain-ledger/comments">Leave a comment</a></p>
            <p>You are receiving this because you subscribed to Harborline.
              <a href="https://harborline.substack.com/account">Manage your subscription</a> or
              <a href="https://harborline.substack.com/action/disable_email">unsubscribe</a>.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const PLAIN = `The Grain Ledger

Every port keeps two sets of books. The first is the one the harbour master signs.

Read the full post: https://harborline.substack.com/p/the-grain-ledger`;

/** A long HTML essay whose first `/p/` link, behind two unusable anchors, is the post. */
export const ESSAY_MESSAGE: GmailMessage = {
  id: 'gmail-essay-1',
  threadId: 'thread-essay-1',
  labelIds: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'],
  internalDate: '1789000000000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Mira Vantz <harborline@substack.com>' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Subject', value: 'The Grain Ledger' },
      { name: 'Date', value: 'Tue, 16 Sep 2026 11:06:40 +0000' },
      { name: 'Message-ID', value: '<essay-1@mail.harborline.substack.com>' },
      {
        name: 'List-Unsubscribe',
        value:
          '<https://harborline.substack.com/action/disable_email>, <mailto:unsub@substack.com>',
      },
    ],
    parts: [
      {
        mimeType: 'text/plain; charset="UTF-8"',
        body: { size: PLAIN.length, data: encodeBody(PLAIN) },
      },
      {
        mimeType: 'text/html; charset="UTF-8"',
        body: { size: HTML.length, data: encodeBody(HTML) },
      },
    ],
  },
};
