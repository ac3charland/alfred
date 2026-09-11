import { makeCommAccount, makeCommMessage } from '@/lib/comms/fixtures';

import { messageDeepLink } from './deep-link';

const GMAIL = makeCommAccount('RealPlay', { kind: 'gmail' });
const WORKMAIL = makeCommAccount('WorkMail', { kind: 'imap', home: 'daemon' });
const IMESSAGE = makeCommAccount('iMessage', { kind: 'imessage', home: 'daemon' });

describe('messageDeepLink — email', () => {
  it('builds an Apple Mail link from the Message-ID, angle brackets encoded', () => {
    const message = makeCommMessage(GMAIL.id, {
      rfc822_message_id: '<CAF=abc123@mail.gmail.com>',
    });

    expect(messageDeepLink(message, GMAIL)).toEqual({
      label: 'Open in Mail',
      href: 'message://%3CCAF%3Dabc123@mail.gmail.com%3E',
      unavailable: undefined,
    });
  });

  it('accepts an id stored without its brackets', () => {
    const message = makeCommMessage(WORKMAIL.id, { rfc822_message_id: 'plain-id@corp.example' });

    expect(messageDeepLink(message, WORKMAIL).href).toBe('message://%3Cplain-id@corp.example%3E');
  });

  it('keeps the @ unescaped but escapes what would break the URL', () => {
    const message = makeCommMessage(GMAIL.id, { rfc822_message_id: '<a b/c@host>' });

    expect(messageDeepLink(message, GMAIL).href).toBe('message://%3Ca%20b%2Fc@host%3E');
  });

  it('disables the link, with a reason, when no Message-ID was captured', () => {
    const message = makeCommMessage(GMAIL.id, { rfc822_message_id: null });
    const link = messageDeepLink(message, GMAIL);

    expect(link.href).toBeUndefined();
    expect(link.unavailable).toContain('No Message-ID');
    expect(link.label).toBe('Open in Mail');
  });

  it('treats a blank Message-ID as no Message-ID', () => {
    const message = makeCommMessage(GMAIL.id, { rfc822_message_id: ' '.repeat(3) });

    expect(messageDeepLink(message, GMAIL).href).toBeUndefined();
  });
});

describe('messageDeepLink — iMessage', () => {
  it('addresses a one-to-one chat by the sender handle', () => {
    const message = makeCommMessage(IMESSAGE.id, { sender_handle: '+15550102233' });

    expect(messageDeepLink(message, IMESSAGE)).toEqual({
      label: 'Open in Messages',
      href: 'imessage://+15550102233',
      unavailable: undefined,
    });
  });

  it('opens Messages itself for a named group — a group has no single addressee', () => {
    const message = makeCommMessage(IMESSAGE.id, {
      sender_handle: '+15550102233',
      chat_name: 'Sunday plans',
    });

    expect(messageDeepLink(message, IMESSAGE).href).toBe('imessage://');
  });

  it('treats several participants as a group even with no chat name', () => {
    const message = makeCommMessage(IMESSAGE.id, {
      sender_handle: '+15550102233',
      participants: ['+15550102233', '+15550109988'],
    });

    expect(messageDeepLink(message, IMESSAGE).href).toBe('imessage://');
  });

  it('still opens the app when the handle is missing — one click closer than nothing', () => {
    const message = makeCommMessage(IMESSAGE.id, { sender_handle: '' });

    expect(messageDeepLink(message, IMESSAGE).href).toBe('imessage://');
  });
});

describe('messageDeepLink — no account', () => {
  it('disables the control rather than guessing a client', () => {
    const message = makeCommMessage(GMAIL.id, { rfc822_message_id: '<a@b>' });
    const link = messageDeepLink(message, undefined);

    expect(link.href).toBeUndefined();
    expect(link.label).toBe('Open in source');
    expect(link.unavailable).toContain("can't tell which account");
  });
});
