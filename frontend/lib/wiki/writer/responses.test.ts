/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { WikiWriteError, type WikiWriteErrorKind } from './commit';
import { wikiUnconfiguredResponse, wikiWriteErrorResponse } from './responses';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));

describe('wikiUnconfiguredResponse', () => {
  it('answers 501 with the exact sentence the Reader store toasts', async () => {
    const response = wikiUnconfiguredResponse();

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'The wiki is not configured on this deployment',
    });
  });
});

describe('wikiWriteErrorResponse', () => {
  it('answers 503 for a busy repo, so the caller knows to retry soon', async () => {
    const response = wikiWriteErrorResponse(
      new WikiWriteError('busy', 'wiki: main moved on every attempt'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'The wiki repo was busy — try again' });
  });

  it.each<WikiWriteErrorKind>(['unauthorized', 'rejected', 'unreachable'])(
    'answers 502 for a %s failure — GitHub refused or never fully answered',
    async (kind) => {
      const response = wikiWriteErrorResponse(new WikiWriteError(kind, `wiki: ${kind}`));

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({ error: "Couldn't reach the wiki repo" });
    },
  );
});
