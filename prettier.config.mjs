/** @type {import('prettier').Config} */
export default {
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
  semi: true,
  printWidth: 100,
  plugins: ['@trivago/prettier-plugin-sort-imports'],

  // --- @trivago/prettier-plugin-sort-imports options ---
  // importOrder: regex groups, applied in order; unmatched third-party goes to <THIRD_PARTY_MODULES>.
  importOrder: [
    '<BUILTIN_MODULES>',
    '<THIRD_PARTY_MODULES>',
    // Monorepo-internal workspace packages.
    '^(frontend|workers|database)(/.*)?$',
    // Path-alias imports.
    '^@/(.*)$',
    // Relative imports.
    '^[./]',
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
};
