/**
 * Substack the PLATFORM writing to the owner, not a publication they subscribe to.
 *
 * It carries a list header and it comes from `substack.com`, so the two signals discovery leans
 * on are both present — and it is still not a publication. `v_reader_discovery` excludes it by
 * refusing the `no-reply` / `noreply` local parts, and `discoverPublications` refuses them a
 * second time on its own, because a roster row is hard to notice and harder to remove once the
 * reading list has filled with digests of "someone you follow just posted".
 *
 * Its own links go through the platform's redirector rather than straight at a `/p/` path, which
 * is both what Substack actually sends and what keeps this fixture's extraction honest: a digest
 * has no canonical post of its own, and resolving it to somebody else's would be a lie the eval's
 * dry-run prints every time it replays the set.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

const HTML = `<!doctype html>
<html>
  <head><title>Your weekly Substack digest</title></head>
  <body>
    <table width="600" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td style="padding:24px;">
        <h1>What you missed this week</h1>
        <p>Three writers you follow published something new.</p>
        <ul>
          <li><a href="https://substack.com/redirect/harborline-latest">The Grain Ledger</a> by Mira Vantz</li>
          <li><a href="https://substack.com/redirect/slackwater-latest">Against the sprint</a> by Jo Enns</li>
        </ul>
        <p><a href="https://substack.com/notifications">Manage what we send you</a></p>
      </td></tr>
    </table>
  </body>
</html>`;

/** Platform mail: a list header, a `substack.com` sender, and a `no-reply` local part. */
export const PLATFORM_MAIL_MESSAGE: GmailMessage = {
  id: 'gmail-platform-1',
  threadId: 'thread-platform-1',
  labelIds: ['INBOX', 'CATEGORY_UPDATES'],
  internalDate: '1789010800000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Substack <no-reply@substack.com>' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Subject', value: 'Your weekly Substack digest' },
      { name: 'Date', value: 'Tue, 16 Sep 2026 14:06:40 +0000' },
      { name: 'Message-ID', value: '<digest-1@mail.substack.com>' },
      { name: 'List-Unsubscribe', value: '<https://substack.com/notifications>' },
    ],
    parts: [
      {
        mimeType: 'text/html; charset="UTF-8"',
        body: { size: HTML.length, data: encodeBody(HTML) },
      },
    ],
  },
};
