/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { z } from 'zod';

import { parseQueryParams, parseRequestBody } from './parsing';

// ---------------------------------------------------------------------------
// parseRequestBody
// ---------------------------------------------------------------------------

const bodySchema = z.object({ name: z.string().min(1) });

/** Build a POST Request whose body is the given raw string (not re-serialised). */
function rawBodyRequest(body: string): Request {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonBodyRequest(body: unknown): Request {
  return rawBodyRequest(JSON.stringify(body));
}

describe('parseRequestBody', () => {
  it('returns the parsed data on a valid body', async () => {
    const result = await parseRequestBody(jsonBodyRequest({ name: 'Alfred' }), bodySchema);
    expect(result).toStrictEqual({ name: 'Alfred' });
  });

  it('returns a 400 "Invalid JSON body" Response when the body is not valid JSON', async () => {
    const result = await parseRequestBody(rawBodyRequest('not-json'), bodySchema);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns a 400 "Invalid request body" Response with issues when validation fails', async () => {
    const result = await parseRequestBody(jsonBodyRequest({ name: '' }), bodySchema);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string; details?: unknown };
    expect(json.error).toBe('Invalid request body');
    // The zod issues are forwarded as `details` for the caller to inspect.
    expect(Array.isArray(json.details)).toBe(true);
  });

  it('uses a custom error message for the schema-failure branch when provided', async () => {
    const result = await parseRequestBody(jsonBodyRequest({ name: '' }), bodySchema, 'Bad fields');
    const response = result as Response;
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe('Bad fields');
  });

  it('does NOT use the custom message for the invalid-JSON branch (always "Invalid JSON body")', async () => {
    const result = await parseRequestBody(rawBodyRequest('{bad'), bodySchema, 'Bad fields');
    const response = result as Response;
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe('Invalid JSON body');
  });
});

// ---------------------------------------------------------------------------
// parseQueryParams
// ---------------------------------------------------------------------------

const querySchema = z.object({
  folder: z.uuid().optional(),
  status: z.enum(['active', 'completed', 'all']).optional(),
});

describe('parseQueryParams', () => {
  it('returns the parsed query object for a valid query string', () => {
    const request = new Request('http://localhost/api/items?status=completed');
    const result = parseQueryParams(request, querySchema);
    expect(result).toStrictEqual({ status: 'completed' });
  });

  it('omits absent params (treats missing as undefined, not empty string)', () => {
    const request = new Request('http://localhost/api/items');
    const result = parseQueryParams(request, querySchema);
    expect(result).toStrictEqual({});
  });

  it('returns a 400 "Invalid query parameters" Response with issues on a bad value', async () => {
    const request = new Request('http://localhost/api/items?status=archived');
    const result = parseQueryParams(request, querySchema);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string; details?: unknown };
    expect(json.error).toBe('Invalid query parameters');
    expect(Array.isArray(json.details)).toBe(true);
  });

  it('parses every key the URL declares (passes the full param set to the schema)', () => {
    const folderId = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';
    const request = new Request(`http://localhost/api/items?folder=${folderId}&status=active`);
    const result = parseQueryParams(request, querySchema);
    expect(result).toStrictEqual({ folder: folderId, status: 'active' });
  });
});
