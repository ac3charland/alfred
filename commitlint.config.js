// GitHub skips every push/pull_request workflow run for a commit whose message carries one of
// these tokens (or `skip-checks: true`, a trailer this config already forbids via footer-empty).
// The repo is public and its secret-scan workflow runs on push, so such a message would silence it.
const CI_SKIP_TOKEN = /\[\s*(?:skip ci|ci skip|no ci|skip actions|actions skip)\s*\]|\*\*\*NO_CI\*\*\*/i;

/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        // 'never' negates the condition: error when the message contains a CI-skip token.
        'no-ci-skip': ({ raw }) => {
          const found = CI_SKIP_TOKEN.exec(raw ?? '');
          return [
            found === null,
            `message must not contain the CI-skip token ${found?.[0] ?? ''}: it silences the push workflows, including the secret scan`,
          ];
        },
      },
    },
  ],
  rules: {
    // Never let a message switch off the push workflows (see CI_SKIP_TOKEN)
    'no-ci-skip': [2, 'always'],
    // Single-line commits only: no body or footer allowed
    'body-empty': [2, 'always'],
    'footer-empty': [2, 'always'],
    // Subject must start with lowercase (matches project history; allows camelCase identifiers)
    'subject-case': [
      2,
      'never',
      ['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
    ],
    // No trailing period on subject
    'subject-full-stop': [2, 'never', '.'],
    // Scope is required (parentheses must be present)
    'scope-empty': [2, 'never'],
    // Scope must be lower-case: lowercase letters, digits and hyphens are all fine
    // (e.g. `e2e`, `back-pressure`). NOT kebab-case — commitlint's kebab check runs the
    // scope through lodash.kebabCase, which treats digits as word boundaries and rejects
    // perfectly good scopes like `e2e` (it demands `e-2-e`). lower-case still rejects
    // camelCase / PascalCase / UPPER, which is the casing we actually care about.
    'scope-case': [2, 'always', 'lower-case'],
  },
};

module.exports = config;
