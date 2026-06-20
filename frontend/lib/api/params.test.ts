/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { parseUUID } from './params';

const VALID_UUID = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';

describe('parseUUID', () => {
  it('returns the value unchanged when it is a valid UUID', () => {
    expect(parseUUID(VALID_UUID)).toBe(VALID_UUID);
  });

  it('returns a 400 Response for a non-UUID value', () => {
    const result = parseUUID('not-a-uuid');
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(400);
  });

  it('uses the default field name "id" in the error message', async () => {
    const response = parseUUID('nope') as Response;
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe('Invalid id');
  });

  it('uses a custom field name in the error message', async () => {
    const response = parseUUID('nope', 'folder_id') as Response;
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe('Invalid folder_id');
  });

  it('rejects an empty string', () => {
    expect(parseUUID('')).toBeInstanceOf(Response);
  });
});
