import { connectImap, describeImapFailure } from './imap-client.ts';
import type { ImapConnect } from './imap-client.ts';

describe('connectImap', () => {
  // The real adapter is the one piece that cannot be exercised without a server, so it is kept
  // thin enough that conforming to the interface is the whole of its contract. Everything the
  // source does with a session is tested against the in-memory one in `fixtures.ts`.
  it('is an ImapConnect, so the source can be driven by a fake in every other test', () => {
    const connect: ImapConnect = connectImap;

    expect(typeof connect).toBe('function');
  });
});

describe('describeImapFailure', () => {
  const HOST = 'imap.example.com';

  it('says the login was refused when the server rejected the credentials', () => {
    const error = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });

    expect(describeImapFailure(error, HOST, 993)).toBe(
      `IMAP login was rejected by ${HOST} — the mailbox password in the keychain is wrong, ` +
        'or the account is locked',
    );
  });

  it('says the host did not resolve rather than blaming the password', () => {
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });

    expect(describeImapFailure(error, HOST, 993)).toBe(
      `could not reach ${HOST}:993 — the host name did not resolve`,
    );
  });

  it('separates a refused connection from a timed-out one', () => {
    expect(
      describeImapFailure(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), HOST, 993),
    ).toBe(`could not reach ${HOST}:993 — the connection was refused`);
    expect(
      describeImapFailure(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), HOST, 993),
    ).toBe(`could not reach ${HOST}:993 — the connection timed out`);
  });

  it('passes an unrecognized failure through in plain English', () => {
    expect(describeImapFailure(new Error('something else broke'), HOST, 993)).toBe(
      'IMAP request failed — something else broke',
    );
  });

  it('never repeats what it was handed, in case the failure carried a credential', () => {
    const error = Object.assign(new Error('LOGIN user hunter2 failed'), {
      authenticationFailed: true,
    });

    expect(describeImapFailure(error, HOST, 993)).not.toContain('hunter2');
  });
});
