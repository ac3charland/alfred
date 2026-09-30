/**
 * A link roundup in the template Substack ships today — the case the Further reading list is
 * mostly about.
 *
 * Every body link is an opaque `substack.com/redirect/<uuid>` wrapper, as in real mail, so nothing
 * about a link's host says whether it is worth reading: only the prose around it does. Around the
 * five roundup items sit everything a link list must not become — a sponsor block, a repeat of the
 * lead item's link further down, the byline (`substack.com/@…`), the app link, the chrome's
 * `redirect/2/<base64>` wrappers, the post's own `/pub/<name>/p/<slug>` pair, and the
 * subscription footer — so the candidate filter and the model's judgment each have something to
 * refuse.
 *
 * The publication, every address, slug, uuid and line of prose are invented.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

/** `display:none`, exactly as the template spells it on both preheaders. */
const HIDDEN =
  'display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;';

const HTML = `<!doctype html>
<html lang="en" dir="ltr">
  <head><meta charset="utf-8"><title>Gridwork 212: three new evals, and a robot that folds</title></head>
  <body class="email-body">
    <div class="preview" style="${HIDDEN}">Most of this week restates last week; one eval does not</div>
    <table class="email-body-container" width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td style="padding:16px 24px;font-size:12px;color:#777;">
            <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9ncmlkd29yay5zdWJzdGFjay5jb20vc3Vic2NyaWJlIn0">Subscribe here</a>
          </td></tr>
          <tr><td style="padding:0 24px;">
            <h1><a href="https://substack.com/app-link/post?publication_id=5521&amp;post_id=88121&amp;utm_source=email">Gridwork 212: three new evals, and a robot that folds</a></h1>
            <p style="color:#777;font-size:13px;"><a href="https://substack.com/@tovehallam">Tove Hallam</a> &middot; 9 min read</p>
            <a href="https://open.substack.com/pub/gridwork/p/gridwork-212?utm_source=email&amp;utm_campaign=email-read-in-app">READ IN APP</a>
            <p>Most of this week restates last week&rsquo;s benchmark releases. The one new thing is a
              dexterity eval with a sim-to-real gap nobody expected.</p>
            <h2>The lead</h2>
            <p>The folding result comes from
              <a href="https://substack.com/redirect/3d1f6a52-8b0e-4c7a-9e21-0a4f5c6d7e81">The sim-to-real gap in dexterous manipulation</a>,
              which reports per-task numbers for the whole benchmark. Read it for Table 3.</p>
            <p>An essay I keep returning to argues the suite measures the simulator, not the policy:
              <a href="https://substack.com/redirect/7a2e9c14-5b3d-4f60-8a19-2c7d0e1b6f93">Why most robotics evals don&rsquo;t transfer</a>.</p>
            <table role="presentation" style="background:#f4f4f4;"><tr><td style="padding:12px;">
              <p><strong>Sponsored</strong> &mdash; This issue is brought to you by Quillhook.
                <a href="https://substack.com/redirect/c4b8e2f0-1a6d-4e97-b3c5-8d2f0a9e7c16">Try Quillhook free for 30 days</a>.</p>
            </td></tr></table>
            <h2>Also this week</h2>
            <ul>
              <li><a href="https://substack.com/redirect/e9d0c3b7-6f24-4a8e-9b51-3c7f2d8a0e44">FoldBench v2 release notes</a>
                &mdash; the eval itself; skim it for the task list.</li>
              <li><a href="https://substack.com/redirect/1f7b3e9a-0c52-4d86-a4e1-9b2c6d3f8a07">A sceptic&rsquo;s reply to &ldquo;scale the simulator&rdquo;</a>
                &mdash; the best case against my own view.</li>
              <li><a href="https://substack.com/redirect/5a0c8d2e-7b41-4f93-8e6a-1d9b3c5f2e70">Yet another leaderboard</a>
                &mdash; the same twelve models in a new order.</li>
            </ul>
            <p>If you read one thing, make it
              <a href="https://substack.com/redirect/3d1f6a52-8b0e-4c7a-9e21-0a4f5c6d7e81">the sim-to-real paper</a>.</p>
          </td></tr>
          <tr><td style="padding:24px;border-top:1px solid #e4e4e4;font-size:12px;color:#777;">
            <p><strong>Read next</strong> &mdash;
              <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9ncmlkd29yay5zdWJzdGFjay5jb20vcC9ncmlkd29yay0yMTEifQ">Gridwork 211</a></p>
            <p>You are receiving this because you subscribed to Gridwork.
              <a href="https://substack.com/redirect/0b6e4d1c-9a37-4f25-8c80-5e2a7d9f1b36">Manage your subscription</a> or
              <a href="https://substack.com/redirect/8e3a5f2d-4c19-4b70-9d68-7f1e0c2b5a93">unsubscribe</a>.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

/** The plain alternative, as short as Substack's own for a roundup: the extractor prefers the HTML. */
const PLAIN = `View this post on the web at https://gridwork.substack.com/p/gridwork-212

Most of this week restates last week's benchmark releases. The one new thing is a dexterity eval
with a sim-to-real gap nobody expected.`;

/** A roundup whose body links are all `redirect/<uuid>` wrappers, among sponsor and chrome links. */
export const LINK_ROUNDUP_MESSAGE: GmailMessage = {
  id: 'gmail-link-roundup-1',
  threadId: 'thread-link-roundup-1',
  labelIds: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'],
  internalDate: '1789500000000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'Mime-Version', value: '1.0' },
      { name: 'Subject', value: 'Gridwork 212: three new evals, and a robot that folds' },
      { name: 'From', value: 'Tove Hallam from Gridwork <gridwork@substack.com>' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Message-Id', value: '<link-roundup-1@mail.gridwork.substack.com>' },
      { name: 'Date', value: 'Mon, 22 Sep 2026 06:00:00 +0000' },
      { name: 'List-Id', value: 'Gridwork <gridwork.substack.com>' },
    ],
    parts: [
      {
        mimeType: 'text/plain',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset="utf-8"' }],
        body: { size: PLAIN.length, data: encodeBody(PLAIN) },
      },
      {
        mimeType: 'text/html',
        headers: [{ name: 'Content-Type', value: 'text/html; charset="utf-8"' }],
        body: { size: HTML.length, data: encodeBody(HTML) },
      },
    ],
  },
};
