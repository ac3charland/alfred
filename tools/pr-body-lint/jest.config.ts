import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  // The source imports local modules with an explicit `.ts` extension (required
  // by Node's native TypeScript loader). Strip that extension so Jest's resolver
  // finds the underlying module the same way the runtime does.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.ts$': '$1',
  },
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  restoreMocks: true,
};

export default config;
