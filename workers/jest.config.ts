import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // Don't discover the test copies Stryker writes into its sandbox during a `mutation` run —
  // jest scans the whole tree, so a concurrent run would otherwise double-run (and fail) them.
  testPathIgnorePatterns: ['/node_modules/', '/.stryker-tmp/'],
  clearMocks: true,
  restoreMocks: true,
};

export default config;
