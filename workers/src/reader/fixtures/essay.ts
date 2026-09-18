/**
 * The ordinary case: a long Substack essay in the template the platform ships today.
 *
 * Everything the extractor has to get right about a POST mail is in here, in the order real mail
 * puts it. The first two anchors are `substack.com/redirect/2/<base64>` wrappers — the second one
 * carries the post's own URL inside its base64 payload, and must still NOT become the canonical
 * URL, because the wrapper expires. Then the app link (which has no slug), then the byline link,
 * and only then the post's address, twice, as `open.substack.com/pub/<name>/p/<slug>` — the second
 * of the pair is the `READ IN APP` button. No anchor anywhere is a bare `<pub>.substack.com/p/…`:
 * the live template does not carry one, and a fixture that carried one would let a rule that only
 * works on the old shape pass.
 *
 * The two `display:none` divs at the top are the preheaders: a preview line, then a padding run of
 * invisible characters that reaches a naive word count as some 200 empty words. The `From` display
 * name is the `<Author> from <Publication>` shape, and the `Subject` is two ADJACENT RFC 2047
 * encoded words split mid-word, carrying a curly apostrophe and an emoji — all three are what the
 * owner's own mailbox holds.
 *
 * The publication is invented, as is every address, slug and line of prose: nothing personal
 * appears in any fixture.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

/**
 * The second preheader's payload: U+034F, NBSP, U+2007 and a soft hyphen, over and over, padding
 * the inbox preview line out. Written as a repeat rather than 400 literal characters so the shape
 * is legible; real mail sends about this much.
 */
const PREHEADER_PADDING = '&#847; &nbsp; &#8199; &#173;'.repeat(100);

/** `display:none`, exactly as the template spells it on both preheaders. */
const HIDDEN =
  'display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;';

const HTML = `<!doctype html>
<html lang="en" dir="ltr">
  <head><meta charset="utf-8"><title>Harborline &#8212; The Grain Ledger</title></head>
  <body class="email-body" style="font-kerning:auto;">
    <img src="https://eotrx.substackcdn.com/o/4f1c9a/p.gif?token=eyJwIjoxLCJ0IjoibmV3c2xldHRlciJ9"
         alt="" width="1" height="1" border="0" style="height:1px !important;width:1px !important;" />
    <div class="preview" style="${HIDDEN}">What three open berth feeds did to the price of a badly-routed cargo</div>
    <div class="preview" style="${HIDDEN}">${PREHEADER_PADDING}</div>
    <table class="email-body-container" width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td style="padding:16px 24px;font-size:12px;color:#777;">
            <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9oYXJib3JsaW5lLnN1YnN0YWNrLmNvbS9zdWJzY3JpYmU_dXRtX3NvdXJjZT1lbWFpbCJ9">Subscribe here</a>
          </td></tr>
          <tr><td style="padding:0 24px;">
            <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9oYXJib3JsaW5lLnN1YnN0YWNrLmNvbS9wL3RoZS1ncmFpbi1sZWRnZXI_dXRtX3NvdXJjZT1lbWFpbCJ9"><img
                 src="https://substackcdn.com/image/fetch/harborline-hero.png"
                 alt="A grain elevator at dusk, seen from the rail siding" width="552" /></a>
            <h1 style="font-size:28px;line-height:1.2;">
              <a href="https://substack.com/app-link/post?publication_id=2144703&amp;post_id=20754223&amp;utm_source=email">The Grain Ledger</a>
            </h1>
            <p style="color:#777;font-size:13px;">
              <a href="https://substack.com/@miravantz">Mira Vantz</a> &middot; 14 min read</p>
            <a href="https://open.substack.com/pub/harborline/p/the-grain-ledger?utm_source=email&amp;utm_campaign=email-post-title"><img
                 src="https://substackcdn.com/image/fetch/harborline-mark.png" alt="" width="24" /></a>
            <a href="https://open.substack.com/pub/harborline/p/the-grain-ledger?utm_source=email&amp;utm_campaign=email-read-in-app">READ IN APP</a>
            <p>Every port keeps two sets of books. The first is the one the harbour master signs:
              tonnes in, tonnes out, a stamp, a date. The second is the one the elevator operators
              keep in their heads &mdash; which berths silt up in August, whose barges run light,
              which inspector will wave through a load that is 2% over moisture.</p>
            <p>For a century the second ledger was the valuable one, and it was unwritable. That is
              what has changed. Three port authorities have now
              <a href="https://substack.com/redirect/8f2c0b7e-4d19-4a2b-9c51-6f0ab2e77d41">published their
              berth-occupancy telemetry</a> as an open feed, and within eighteen months the spread
              between a well-routed cargo and a badly-routed one narrowed from about $4.10 a tonne
              to $1.30.</p>
            <blockquote>&ldquo;We did not make anyone smarter,&rdquo; the programme lead told me.
              &ldquo;We made it impossible to be the only person in the room who knew.&rdquo;</blockquote>
            <p>The counter-argument is the obvious one, and it is not wrong: the operators who held
              the second ledger were paid for holding it, and a great many of them are now paid
              less. But the tonnage moved per berth-hour is up 11% across the three ports, and the
              waiting-time distribution has
              <a href="https://substack.com/redirect/1b6d40aa-2f77-4c0e-8f13-9a5e2c1d3b88">lost its long
              right tail</a> entirely.</p>
            <p>What I cannot yet tell you is whether this survives contact with a bad year. Every
              one of these eighteen months has been a calm-weather month with slack capacity.</p>
          </td></tr>
          <tr><td style="padding:24px;border-top:1px solid #e4e4e4;font-size:12px;color:#777;">
            <p><strong>Read next</strong> &mdash;
              <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9oYXJib3JsaW5lLnN1YnN0YWNrLmNvbS9wL3RoZS1yb3RhLXByb2JsZW0_dXRtX3NvdXJjZT1lbWFpbCJ9">Why every rota becomes a seniority ladder</a></p>
            <p>You are receiving this because you subscribed to Harborline.
              <a href="https://substack.com/redirect/6c3e19d5-70b8-4a51-bb2f-52f0c8e9a4d7">Manage your subscription</a> or
              <a href="https://substack.com/redirect/9a7f22c1-05de-4b39-8c64-1d33ba70e5f2">unsubscribe</a>.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

/**
 * The plain alternative: a COMPLETE second rendering of the post, opening with the line Substack
 * puts at the top of every one of them. It is cleaner prose than the markup — the extractor still
 * prefers the HTML, because that is where the links and the structure are.
 */
const PLAIN = `View this post on the web at https://harborline.substack.com/p/the-grain-ledger

Every port keeps two sets of books. The first is the one the harbour master signs: tonnes in,
tonnes out, a stamp, a date. The second is the one the elevator operators keep in their heads —
which berths silt up in August, whose barges run light, which inspector will wave through a load
that is 2% over moisture.

For a century the second ledger was the valuable one, and it was unwritable. That is what has
changed. Three port authorities have now published their berth-occupancy telemetry as an open
feed [ https://substack.com/redirect/8f2c0b7e-4d19-4a2b-9c51-6f0ab2e77d41 ], and within eighteen
months the spread between a well-routed cargo and a badly-routed one narrowed from about $4.10 a
tonne to $1.30.

"We did not make anyone smarter," the programme lead told me. "We made it impossible to be the
only person in the room who knew."

The counter-argument is the obvious one, and it is not wrong: the operators who held the second
ledger were paid for holding it, and a great many of them are now paid less. But the tonnage
moved per berth-hour is up 11% across the three ports, and the waiting-time distribution has lost
its long right tail entirely.

What I cannot yet tell you is whether this survives contact with a bad year. Every one of these
eighteen months has been a calm-weather month with slack capacity.

Unsubscribe https://substack.com/redirect/9a7f22c1-05de-4b39-8c64-1d33ba70e5f2`;

/**
 * A long HTML essay whose only post link is the `open.substack.com/pub/…/p/…` pair.
 *
 * The subject decodes to `Harborline’s Grain Ledger 🤝 the berth telemetry`: two adjacent encoded
 * words, the split falling inside "telemetry", joined with no space between them.
 */
export const ESSAY_MESSAGE: GmailMessage = {
  id: 'gmail-essay-1',
  threadId: 'thread-essay-1',
  labelIds: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'],
  internalDate: '1789000000000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'Mime-Version', value: '1.0' },
      { name: 'Content-Type', value: 'multipart/alternative; boundary="--=_harborline"' },
      {
        name: 'Subject',
        value:
          '=?UTF-8?q?Harborline=E2=80=99s_Grain_Ledger_=F0=9F=A4=9D_the_berth_teleme?= =?UTF-8?q?try?=',
      },
      { name: 'From', value: 'Mira Vantz from Harborline <harborline@substack.com>' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Message-Id', value: '<essay-1@mail.harborline.substack.com>' },
      { name: 'Date', value: 'Tue, 16 Sep 2026 11:06:40 +0000' },
      { name: 'Sender', value: 'harborline@substack.com' },
      { name: 'List-Id', value: 'Harborline <harborline.substack.com>' },
      {
        name: 'List-Unsubscribe',
        value:
          '<https://harborline.substack.com/action/disable_email>, <mailto:unsub@substack.com>',
      },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
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
