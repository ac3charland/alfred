/**
 * A link roundup in the live Substack template — the case the Further reading list is for.
 *
 * Every body link is an opaque `substack.com/redirect/<uuid>` wrapper, as in real mail, so the
 * only thing that says what a link is for is the prose around it. In document order the mail
 * carries: the two `redirect/2/<base64>` chrome wrappers (subscribe, the hero image), the app link,
 * the byline, the post's own `open.substack.com/pub/…/p/…` address twice (the logo, then
 * `READ IN APP`), then five numbered items whose first link reappears in the closing paragraph,
 * a sponsor block, an image-only link, a `mailto:` and the footer's two wrappers. Which of the
 * five items are worth reading is the model's call; the fixture only has to put every kind of
 * anchor the pre-filter must keep or drop in front of it.
 *
 * The publication, every address, uuid and line of prose are invented.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

/** `display:none`, exactly as the template spells its preheader. */
const HIDDEN =
  'display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;';

const HTML = `<!doctype html>
<html lang="en" dir="ltr">
  <head><meta charset="utf-8"><title>Import Notes 412</title></head>
  <body class="email-body">
    <div class="preview" style="${HIDDEN}">Three new evals, and a robot that folds</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation">
          <tr><td style="padding:16px 24px;font-size:12px;color:#777;">
            <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9pbXBvcnRub3Rlcy5zdWJzdGFjay5jb20vc3Vic2NyaWJlIn0">Subscribe here</a>
          </td></tr>
          <tr><td style="padding:0 24px;">
            <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9pbXBvcnRub3Rlcy5zdWJzdGFjay5jb20vcC80MTIifQ"><img
                 src="https://substackcdn.com/image/fetch/import-notes-hero.png" alt="A robot arm folding a towel" width="552" /></a>
            <h1><a href="https://substack.com/app-link/post?publication_id=3301&amp;post_id=412">Import Notes 412: three new evals, and a robot that folds</a></h1>
            <p style="color:#777;font-size:13px;">
              <a href="https://substack.com/@jonaskettle">Jonas Kettle</a> · 9 min read</p>
            <a href="https://open.substack.com/pub/importnotes/p/import-notes-412?utm_source=email&amp;utm_campaign=email-post-title"><img
                 src="https://substackcdn.com/image/fetch/import-notes-mark.png" alt="" width="24" /></a>
            <a href="https://open.substack.com/pub/importnotes/p/import-notes-412?utm_source=email&amp;utm_campaign=email-read-in-app">READ IN APP</a>
            <p>Most of this week restates last week’s benchmark releases. The one new thing is a
              dexterity eval with a sim-to-real gap nobody expected.</p>
            <ol>
              <li><a href="https://substack.com/redirect/3f1e0c2a-6b7d-4e58-9a14-2c8d5e7f9b01">The sim-to-real gap in dexterous manipulation</a>
                — the paper behind the lead item, with per-task numbers for the folding benchmark.</li>
              <li><a href="https://substack.com/redirect/7a2b9d4e-1c3f-4a6b-8d05-e9f2c1b4a736">Why most robotics evals don’t transfer</a>
                — an essay arguing the suite measures the simulator, not the policy.</li>
              <li><a href="https://substack.com/redirect/c5d8e1f3-2a4b-4c7d-9e60-1b3a5c7d9e2f">FoldBench v2 release notes</a>
                — the eval itself; skim it for the task list.</li>
              <li><a href="https://substack.com/redirect/e9b4c2a1-8d6f-4b3e-a705-4f1d2c8e6b93">A leaderboard update</a>
                — the same three labs, reshuffled.</li>
              <li><a href="https://substack.com/redirect/1d7f3b5c-9e2a-4d8b-b316-7c4e2a9f1d58">A sceptic’s reply to “scale the simulator”</a>
                — the best case against the view I hold.</li>
            </ol>
            <p>If you read one thing, read
              <a href="https://substack.com/redirect/3f1e0c2a-6b7d-4e58-9a14-2c8d5e7f9b01">the gap paper</a>.</p>
            <p style="background:#f4f4f4;padding:12px;">This issue is brought to you by
              <a href="https://substack.com/redirect/88a1b2c3-d4e5-4f60-8a71-b2c3d4e5f607">Gridline, the GPU cloud for evals</a>.</p>
            <a href="https://substack.com/redirect/0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e"><img
                 src="https://substackcdn.com/image/fetch/import-notes-chart.png" alt="" width="552" /></a>
            <p>Reply, or write to <a href="mailto:jonas@importnotes.example">jonas@importnotes.example</a>.</p>
          </td></tr>
          <tr><td style="padding:24px;border-top:1px solid #e4e4e4;font-size:12px;color:#777;">
            <p>You are receiving this because you subscribed to Import Notes.
              <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9pbXBvcnRub3Rlcy5zdWJzdGFjay5jb20vYWNjb3VudCJ9">Manage your subscription</a> or
              <a href="https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly9pbXBvcnRub3Rlcy5zdWJzdGFjay5jb20vdW5zdWJzY3JpYmUifQ">unsubscribe</a>.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

/** A roundup whose body links are all redirect wrappers, with chrome, a sponsor and a repeat. */
export const LINK_ROUNDUP_MESSAGE: GmailMessage = {
  id: 'gmail-link-roundup-1',
  threadId: 'thread-link-roundup-1',
  labelIds: ['INBOX', 'CATEGORY_UPDATES'],
  internalDate: '1789007200000',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Jonas Kettle from Import Notes <importnotes@substack.com>' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Subject', value: 'Import Notes 412: three new evals, and a robot that folds' },
      { name: 'Date', value: 'Tue, 16 Sep 2026 13:06:40 +0000' },
      { name: 'Message-Id', value: '<link-roundup-1@mail.importnotes.substack.com>' },
      { name: 'List-Id', value: 'Import Notes <importnotes.substack.com>' },
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
