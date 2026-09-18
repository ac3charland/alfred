/**
 * A like/reaction notification: another reader reacted to somebody else's post.
 *
 * It is the one Substack mail that still carries a BARE `<pub>.substack.com/p/<slug>` anchor, and
 * the post behind it is not the sender's and not the owner's — so an extraction of it resolves to
 * a post this message is not about. That is exactly why it must never reach the roster: it comes
 * from `reaction@mg1.…`, which is neither a publication's local part nor the one host a
 * publication mails from, and `discoverPublications` refuses both halves (the view refuses the
 * host too). This fixture is what keeps that refusal honest — it is single-part `text/html`, it
 * carries a list header, and every other signal discovery leans on is present.
 *
 * The sending host is `.invalid` rather than `.substack.com` on purpose: nothing in the test suite
 * needs it to be the real host, and a fixture that cannot be mistaken for a live address is worth
 * more than one that can. The reader, the publication and the slug are all invented.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

/** The invisible padding run — the notification templates carry it too. */
const PREHEADER_PADDING = '&#847; &nbsp; &#8199; &#173;'.repeat(100);

/** `display:none`, exactly as the template spells it on both preheaders. */
const HIDDEN =
  'display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;';

const HTML = `<!doctype html>
<html lang="en" dir="ltr">
  <head><meta charset="utf-8"><title>Pell Marrow liked Berth 9 at midnight</title></head>
  <body class="email-body">
    <div class="preview" style="${HIDDEN}">Pell Marrow liked your kind of thing</div>
    <div class="preview" style="${HIDDEN}">${PREHEADER_PADDING}</div>
    <table width="600" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td style="padding:24px;">
        <a href="https://open.substack.com/users/900012-pell-marrow"><img
             src="https://substackcdn.com/image/fetch/pell-avatar.png" alt="" width="40" /></a>
        <p><a href="https://substack.com/@pellmarrow">Pell Marrow</a> liked
          <a href="https://tidewrack.substack.com/p/berth-9-at-midnight">Berth 9 at midnight</a></p>
        <p><a href="https://open.substack.com/users/900012-pell-marrow">View profile</a> &middot;
          <a href="https://tidewrack.substack.com/api/v1/post/900456/unsubscribe">Mute post</a></p>
      </td></tr>
    </table>
  </body>
</html>`;

/** Single-part HTML, a bare `/p/<slug>` anchor, and a sender the roster must never take. */
export const REACTION_NOTIFICATION_MESSAGE: GmailMessage = {
  id: 'gmail-reaction-1',
  threadId: 'thread-reaction-1',
  labelIds: ['INBOX', 'CATEGORY_UPDATES'],
  internalDate: '1789014400000',
  payload: {
    mimeType: 'text/html',
    headers: [
      { name: 'From', value: 'Pell Marrow <reaction@mg1.substack.invalid>' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Subject', value: 'Pell Marrow liked Berth 9 at midnight' },
      { name: 'Date', value: 'Tue, 16 Sep 2026 15:06:40 +0000' },
      { name: 'Message-Id', value: '<reaction-1@mg1.substack.invalid>' },
      { name: 'Content-Type', value: 'text/html; charset="utf-8"' },
      { name: 'Content-Transfer-Encoding', value: 'quoted-printable' },
      {
        name: 'List-Unsubscribe',
        value: '<https://substack.com/notifications>',
      },
    ],
    body: { size: HTML.length, data: encodeBody(HTML) },
  },
};
