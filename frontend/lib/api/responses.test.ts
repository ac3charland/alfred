/** @jest-environment node */
import { jsonError, jsonOk } from './responses';

describe('jsonOk', () => {
  it('returns 200 by default', async () => {
    const response = jsonOk({ id: '1' });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual({ id: '1' });
  });

  it('accepts a custom status code', () => {
    const response = jsonOk({ created: true }, 201);
    expect(response.status).toBe(201);
  });
});

describe('jsonError', () => {
  it('returns the given status and error message', async () => {
    const response = jsonError(400, 'Bad input');
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toStrictEqual({ error: 'Bad input' });
  });

  it('includes details when provided', async () => {
    const response = jsonError(422, 'Validation failed', [{ path: ['title'] }]);
    const body: unknown = await response.json();
    expect(body).toStrictEqual({
      error: 'Validation failed',
      details: [{ path: ['title'] }],
    });
  });
});
