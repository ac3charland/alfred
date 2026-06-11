/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
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
