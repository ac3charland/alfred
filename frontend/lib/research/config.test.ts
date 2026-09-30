/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { getResearchConfig } from './config';

jest.mock('server-only', () => ({}));

const CONFIGURED = {
  RESEARCH_ROUTINE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_01/fire',
  RESEARCH_ROUTINE_FIRE_TOKEN: 'fire-token',
  RESEARCH_DELIVERY_KEY: 'delivery-key',
} as const;

const originalEnvironment = { ...process.env };

/**
 * Give the feature exactly the vars the case declares. Every `RESEARCH_*` var is cleared first,
 * so an ambient value (a developer's `.env.local` loaded into the shell) can't make an "unset"
 * case pass.
 */
function withEnvironment(values: Partial<Record<string, string>>): void {
  process.env = Object.fromEntries(
    Object.entries(originalEnvironment).filter(([name]) => !name.startsWith('RESEARCH_')),
  ) as NodeJS.ProcessEnv;
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) process.env[name] = value;
  }
}

afterAll(() => {
  process.env = originalEnvironment;
});

describe('getResearchConfig', () => {
  it('reads all three values, trimmed', () => {
    withEnvironment({
      RESEARCH_ROUTINE_FIRE_URL: `  ${CONFIGURED.RESEARCH_ROUTINE_FIRE_URL}  `,
      RESEARCH_ROUTINE_FIRE_TOKEN: ' fire-token ',
      RESEARCH_DELIVERY_KEY: ' delivery-key\n',
    });
    expect(getResearchConfig()).toStrictEqual({
      fireUrl: CONFIGURED.RESEARCH_ROUTINE_FIRE_URL,
      fireToken: 'fire-token',
      deliveryKey: 'delivery-key',
    });
  });

  it.each(Object.keys(CONFIGURED))('is undefined when %s is unset', (missing) => {
    withEnvironment({ ...CONFIGURED, [missing]: undefined });
    expect(getResearchConfig()).toBeUndefined();
  });

  it.each(Object.keys(CONFIGURED))('treats a blank %s as unset', (blank) => {
    withEnvironment({ ...CONFIGURED, [blank]: ' '.repeat(3) });
    expect(getResearchConfig()).toBeUndefined();
  });
});
