import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  clearMocks: true,
  restoreMocks: true,
};

export default config;
