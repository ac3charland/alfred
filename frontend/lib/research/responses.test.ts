/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { researchUnconfiguredResponse } from './responses';

jest.mock('server-only', () => ({}));

describe('researchUnconfiguredResponse', () => {
  it('is a 501 that says research is not configured', async () => {
    const response = researchUnconfiguredResponse();

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'Research is not configured on this deployment',
    });
  });
});
