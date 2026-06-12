const { getJestConfig } = require('@storybook/test-runner');

const config = getJestConfig();

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  ...config,
  testTimeout: 30_000,
};
