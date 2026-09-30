/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { hasDeliveryKey } from './auth';

jest.mock('server-only', () => ({}));

const KEY = 'delivery-key-0123456789abcdef';

const CONFIGURED = {
  RESEARCH_ROUTINE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_01/fire',
  RESEARCH_ROUTINE_FIRE_TOKEN: 'fire-token',
  RESEARCH_DELIVERY_KEY: KEY,
} as const;

const originalEnvironment = { ...process.env };

/** Exactly the research vars the case declares; ambient ones (INGEST_API_KEY aside) are cleared. */
function withEnvironment(values: Partial<Record<string, string>>): void {
  process.env = Object.fromEntries(
    Object.entries(originalEnvironment).filter(([name]) => !name.startsWith('RESEARCH_')),
  ) as NodeJS.ProcessEnv;
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) process.env[name] = value;
  }
}

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/reader/research/x', { method: 'PUT', headers });
}

afterAll(() => {
  process.env = originalEnvironment;
});

describe('hasDeliveryKey', () => {
  beforeEach(() => {
    withEnvironment(CONFIGURED);
  });

  it('accepts the key as a bearer token', () => {
    expect(hasDeliveryKey(requestWith({ authorization: `Bearer ${KEY}` }))).toBe(true);
  });

  it('accepts the key in x-api-key', () => {
    expect(hasDeliveryKey(requestWith({ 'x-api-key': KEY }))).toBe(true);
  });

  it.each([
    ['no credential at all', {}],
    ['a wrong bearer token', { authorization: 'Bearer nope' }],
    ['a wrong x-api-key', { 'x-api-key': 'nope' }],
    ['the key with something appended', { authorization: `Bearer ${KEY}x` }],
    ['the key with a character missing', { authorization: `Bearer ${KEY.slice(0, -1)}` }],
    ['the key in a different case', { authorization: `Bearer ${KEY.toUpperCase()}` }],
    ['the key without the Bearer scheme', { authorization: KEY }],
    ['a Basic credential', { authorization: `Basic ${KEY}` }],
    ['an empty bearer token', { authorization: 'Bearer ' }],
    ['an empty x-api-key', { 'x-api-key': '' }],
  ])('refuses %s', (_label, headers) => {
    expect(hasDeliveryKey(requestWith(headers))).toBe(false);
  });

  it('lets x-api-key decide when both headers are sent, as the ingest key does', () => {
    expect(
      hasDeliveryKey(requestWith({ 'x-api-key': 'nope', authorization: `Bearer ${KEY}` })),
    ).toBe(false);
  });

  it('never accepts the ingest key, whatever it holds', () => {
    process.env.INGEST_API_KEY = 'ingest-key-abcdef';

    expect(hasDeliveryKey(requestWith({ authorization: 'Bearer ingest-key-abcdef' }))).toBe(false);
    expect(hasDeliveryKey(requestWith({ 'x-api-key': 'ingest-key-abcdef' }))).toBe(false);
  });

  it('refuses everything when research is not configured, even a key that looks right', () => {
    withEnvironment({ RESEARCH_DELIVERY_KEY: KEY });

    expect(hasDeliveryKey(requestWith({ authorization: `Bearer ${KEY}` }))).toBe(false);
  });

  it('refuses an empty credential when the key is unset, rather than matching empty to empty', () => {
    withEnvironment({});

    expect(hasDeliveryKey(requestWith({ 'x-api-key': '' }))).toBe(false);
    expect(hasDeliveryKey(requestWith({ authorization: 'Bearer ' }))).toBe(false);
  });
});
