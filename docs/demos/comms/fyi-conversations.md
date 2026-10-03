---
branch: alf-307-fyi-conversations
---

# FYI shelf collapses into conversations

*2026-10-03T17:57:58.471Z*

ALF-307: the FYI shelf drew one row per message, so a busy group chat or a long email thread filled it row by row. It now draws one row per conversation. A conversation is an email thread, or an iMessage chat split wherever two shelved messages are more than 6 hours apart. A collapsed conversation shows who it is with, the newest message's line (prefixed with the sender when there are several), the message count as text in the meta line rather than a badge, and every chip its messages carry, counted. Selecting it opens it onto its messages as full shelf rows, newest first. Every shot below is driven through the running app on the Playwright mock-backend harness.

## 1. Before and after, on the same seed

The seed is a 5-message 'Climbing crew' group chat (two photos with no text), a 4-message potluck email thread (one reply refused), Mom texting this afternoon and again last night more than 6 hours earlier, and one Chase statement. **Before** (main): all 15 messages are separate rows.

![](fyi-conversations-image-1.png)

**After**: the same shelf is five rows. 'Climbing crew' goes by its chat name and carries 'Attachment · not read · 2'. The potluck thread is 'Dana Whitfield, Ana Ruiz +1 · 4 messages' with its refused reply rolled up as 'Refused'. Mom's chat is two conversations because its bursts are more than 6 hours apart. Chase, a one-message conversation, is drawn exactly as the row was before. The summary still counts messages (15).

![](fyi-conversations-image-2.png)

## 2. Opening and closing a conversation

Clicking the potluck header selects it, which opens it, and clicking it again closes it. The clip opens, closes and reopens it through the existing height collapse.

![potluck conversation opening, closing and reopening](fyi-conversations-video-3.gif)

Opened, its four messages are full shelf rows, indented under a left rule and newest first. The inner row keeps its own 'Refused' chip.

![](fyi-conversations-image-4.png)

## 3. Walking it with the keyboard

**Step 1**: shelf open, press `j`. The first conversation's header is selected, which opens it.

![](fyi-conversations-image-5.png)

**Step 2**: press `j` again. The walk steps into its newest message, whose detail opens.

![](fyi-conversations-image-6.png)

**Step 3**: press `j` five more times, through Climbing crew's last message and past it. Climbing crew closes and the potluck header is selected and open. Only one conversation is ever open.

![](fyi-conversations-image-7.png)

**Step 4**: press `Esc`. The selection drops and the conversation closes.

![](fyi-conversations-image-8.png)

## 4. Closing a message keeps its conversation open

**Step 1**: in the open potluck thread, click Ana's message. It is selected and its detail opens.

![](fyi-conversations-image-9.png)

**Step 2**: click it again. Ana's detail closes, the selection goes back to the header, and the thread stays open around it.

![](fyi-conversations-image-10.png)

## 5. Promoting a message out of a conversation

**Step 1**: open last night's 'Mom · 2 messages' conversation and select its newest message, 'Night night'.

![](fyi-conversations-image-11.png)

**Step 2**: Change tier → Today. The message leaves the shelf for Today (1). The conversation it left now has one message, so it is drawn as a plain row ('Did you see the photos from the lake?'). The shelf's '15 messages' and 'Show more (1 older)' are the server count, which is only re-read on the next poll. That lag already exists on main and is not part of this change.

![](fyi-conversations-image-12.png)

## 6. A conversation is never cut by a page edge

This seed has 53 shelved messages, one page more than the shelf loads. Priya's reply is the newest message, but the original it replies to is 10 days older than everything else, far past the first page of 50. **Step 1**: on first load, Priya's thread already reads '2 messages', because the server completes every conversation the page holds.

![](fyi-conversations-image-13.png)

**Step 2**: the bottom of the first page, with 'Show more (2 older)'.

![](fyi-conversations-image-14.png)

**Step 3**: after Show more, the two older receipts are appended below the last conversation and the button is gone.

![](fyi-conversations-image-15.png)

## Storybook

No existing visual baseline moved. Three new baselines were added: `Comms/CommsQueueView › ShelfOpen` and `Comms/ShelfConversation › Collapsed / Opened`. Opened has a play function that opens, closes and reopens the conversation.
