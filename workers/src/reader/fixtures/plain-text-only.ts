/**
 * A `text/plain` post with no HTML part and no link of any kind — the Gmail-permalink path.
 *
 * Some publications mail plain text on purpose, and a few mail it by accident when a template
 * fails. Either way there is no markup to walk, so `html_extracted` is false and there is no
 * canonical URL to find: the list row falls back to opening the message in Gmail. The subject is
 * still the title, which is why the extractor takes the title from the header rather than from an `<h1>`
 * that does not exist here.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { encodeBody } from './encode';

const PLAIN = `Notes from the third week

I have been keeping a paper log of every interruption, which is a thing I would have
told you was a waste of a week if someone else had proposed it.

Three findings, none of them what I expected:

1. The interruptions are not the problem. Twenty-one of the thirty-one this week took
   under four minutes. The problem is that eleven of them arrived inside the same two
   hours, and those two hours are the only two I had reserved for anything hard.

2. Nobody interrupts a meeting. A calendar block that says "focus" is interrupted
   freely; the identical block that says "review with Priya" is not. The difference is
   entirely whether a second name is on it.

3. I interrupt myself about as often as anyone else does, and I had not counted those
   at all until I started writing them down.

What I do not know yet is whether writing them down is what changed the number. I will
keep the log another three weeks and report back.

--
You are receiving this because you subscribed. Reply to this email to say hello.`;

/** No HTML part, no anchors, no link: extraction falls back to the plain body. */
export const PLAIN_TEXT_ONLY_MESSAGE: GmailMessage = {
  id: 'gmail-plain-1',
  threadId: 'thread-plain-1',
  labelIds: ['INBOX', 'CATEGORY_UPDATES'],
  internalDate: '1789007200000',
  payload: {
    mimeType: 'text/plain; charset="UTF-8"',
    headers: [
      { name: 'From', value: 'tallowfield@substack.com' },
      { name: 'To', value: 'reader@example.com' },
      { name: 'Subject', value: 'Notes from the third week' },
      { name: 'Date', value: 'Tue, 16 Sep 2026 13:06:40 +0000' },
      { name: 'Message-ID', value: '<plain-1@mail.tallowfield.substack.com>' },
      {
        name: 'List-Unsubscribe',
        value: '<https://tallowfield.substack.com/action/disable_email>',
      },
    ],
    body: { size: PLAIN.length, data: encodeBody(PLAIN) },
  },
};
