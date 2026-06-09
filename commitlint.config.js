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
    // Scope must be kebab-case (matches project history)
    'scope-case': [2, 'always', 'kebab-case'],
  },
};

module.exports = config;
