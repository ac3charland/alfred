/**
 * A link roundup: the Substack template carrying a list of other people's pieces, each with a
 * sentence of commentary, behind `substack.com/redirect/<uuid>` body wrappers.
 *
 * It is the fixture that shows what link numbering is for. A roundup has far more links than an
 * essay, most of them the substance of the post, and only the chrome around them — the subscribe
 * wrapper, the app link, the byline, the post's own address — is noise. The publication, author,
 * links and prose are all invented; nothing personal appears.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

/** `display:none`, as the template spells it on the preheader. */
const HIDDEN =
  'display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;';

const HTML = `<!doctype html>
<html lang="en" dir="ltr">
  <head><meta charset="utf-8"><title>Tideline &#8212; Slow Links, Fast Takes</title></head>
  <body class="email-body" style="font-kerning:auto;">
    <div class="preview" style="${HIDDEN}">Six pieces on tariffs, tidal power and the case against the quarterly review</div>
    <table class="email-body-container" width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td style="padding:16px 24px;font-size:12px;color:#777;">
            <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly90aWRlbGluZS5zdWJzdGFjay5jb20vc3Vic2NyaWJlIn0">Subscribe here</a>
          </td></tr>
          <tr><td style="padding:0 24px;">
            <h1 style="font-size:28px;line-height:1.2;">
              <a href="https://substack.com/app-link/post?publication_id=3381902&amp;post_id=31877410&amp;utm_source=email">Slow Links, Fast Takes</a>
            </h1>
            <p style="color:#777;font-size:13px;">
              <a href="https://substack.com/@odeliahart">Odelia Hart</a> &middot; 6 min read</p>
            <a href="https://open.substack.com/pub/tideline/p/slow-links-fast-takes?utm_source=email&amp;utm_campaign=email-read-in-app">READ IN APP</a>
            <p>Six links this fortnight, and I read all of them to the end, which is the only
              qualification I will claim. Two are genuinely worth your evening. The rest are
              here because they made me argue with the kettle.</p>
            <p><strong>1.</strong>
              <a href="https://substack.com/redirect/3d7a91c2-6b04-4e58-a1f3-0c52de9b7e10">The tariff that taxed the wrong thing</a>
              is a forty-page reconstruction of how a duty meant for steel ended up on the
              pallets the steel travelled on. Dull for a page, then devastating.</p>
            <p><strong>2.</strong>
              <a href="https://substack.com/redirect/b82e4f10-93ac-4d6e-8c17-5a0e61f3d2b9">A tidal barrage costed honestly</a>
              puts the real cost per megawatt-hour at triple the brochure figure, and shows its
              working, which is rarer than it should be.</p>
            <p><strong>3.</strong>
              <a href="https://substack.com/redirect/f4c06d3e-1a85-47b2-9e60-b7d3c8a15f24">The quarterly review is a ritual, not a control</a>
              argues that the meeting exists to calm the people holding it. I think it is half
              right.</p>
            <p><strong>4.</strong>
              <a href="https://substack.com/redirect/0e9b5a77-c2d1-4f38-b64a-3187ad5c9e02">Thirty years of the same pier</a>
              is a photo essay with almost no text and I have looked at it nine times.</p>
            <p><strong>5.</strong>
              <a href="https://substack.com/redirect/6a1d38f9-47b0-4c25-93e8-d2f70b4c1a66">Why the ferry timetable is the way it is</a>
              traces the odd departure minutes to a 1974 pilot-boat agreement. Charming, thin.</p>
            <p><strong>6.</strong> And once more, because it deserves the repeat:
              <a href="https://substack.com/redirect/b82e4f10-93ac-4d6e-8c17-5a0e61f3d2b9">the honest barrage costing</a>.</p>
            <p>Anyone who wants the long version of the argument I keep making about ports can
              start with <a href="https://tideline.substack.com/p/the-quiet-berth">my own piece on the quiet berth</a>.</p>
            <p style="font-size:12px;color:#777;">Today&rsquo;s issue is supported by
              <a href="https://substack.com/redirect/c71f20ab-85e3-4d96-b0c4-9e1a3f6d8b57">Bargewise freight insurance</a>,
              who would like you to know they cover the cargo and the pallets.</p>
          </td></tr>
          <tr><td style="padding:24px;border-top:1px solid #e4e4e4;font-size:12px;color:#777;">
            <p>You are receiving this because you subscribed to Tideline.
              <a href="https://substack.com/redirect/1fd84c06-2b9e-4a73-85d1-e60c97a3b2f8">Manage your subscription</a> or
              <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly90aWRlbGluZS5zdWJzdGFjay5jb20vYWN0aW9uL2Rpc2FibGVfZW1haWwifQ">unsubscribe</a>.</p>
            <a href="https://substack.com/redirect/7d3a5e90-f1c2-4b86-a047-92be1c58d3a4"><img
                 src="https://substackcdn.com/image/fetch/tideline-badge.png" alt="" width="24" /></a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

/** A short plain alternative, opening with the line Substack puts at the top of every one. */
const PLAIN = `View this post on the web at https://tideline.substack.com/p/slow-links-fast-takes

Six links this fortnight, and I read all of them to the end. Two are genuinely worth your evening.

1. The tariff that taxed the wrong thing - a forty-page reconstruction of a duty on pallets.
2. A tidal barrage costed honestly - the real cost per megawatt-hour at triple the brochure figure.
3. The quarterly review is a ritual, not a control.
4. Thirty years of the same pier - a photo essay.
5. Why the ferry timetable is the way it is.

Unsubscribe https://tideline.substack.com/action/disable_email`;

/**
 * A link-roundup newsletter in the live template: many body links behind `substack.com/redirect/
 * <uuid>` wrappers, one of them repeated, a sponsor link wrapped the same way, an own-piece link
 * to the publication's site, and the chrome — a `redirect/2/` subscribe wrapper, the app link, the
 * byline and the `open.substack.com/pub/…/p/…` post link. The link numbering has to keep the first
 * kind and drop the second.
 */
export const ROUNDUP_MESSAGE: GmailMessage = {
  id: 'gmail-roundup-1',
  threadId: 'thread-roundup-1',
  labelIds: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'],
  internalDate: '1789100000000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'Mime-Version', value: '1.0' },
      { name: 'Content-Type', value: 'multipart/alternative; boundary="--=_tideline"' },
      { name: 'Subject', value: 'Slow Links, Fast Takes' },
      { name: 'From', value: 'Odelia Hart from Tideline <tideline@substack.com>' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Message-Id', value: '<roundup-1@mail.tideline.substack.com>' },
      { name: 'Date', value: 'Wed, 17 Sep 2026 14:53:20 +0000' },
      { name: 'Sender', value: 'tideline@substack.com' },
      { name: 'List-Id', value: 'Tideline <tideline.substack.com>' },
    ],
    parts: [
      {
        mimeType: 'text/plain',
        headers: [
          { name: 'Content-Type', value: 'text/plain; charset="utf-8"' },
          { name: 'Content-Transfer-Encoding', value: 'quoted-printable' },
        ],
        body: { size: PLAIN.length, data: encodeBody(PLAIN) },
      },
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
