---
branch: claude/intelligent-wozniak-be3xni
---

# GitHub CI: check:fast and check:slow on pull requests

*2026-06-13T04:15:04.157Z*

Two new GitHub Actions workflows fire on every pull_request event, gating merges on the same two-tier check suite the pre-commit/pre-push hooks enforce locally.

```bash
ls .github/workflows/
```

```output
check-fast.yml
check-slow.yml
```

check-fast.yml runs npm run check:fast (typecheck, lint, format, unit tests) on Node 24 using the .nvmrc version:

```bash
cat .github/workflows/check-fast.yml
```

```output
name: Check Fast

on:
  pull_request:

jobs:
  check-fast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run fast checks
        run: npm run check:fast
```

check-slow.yml runs npm run check:slow (Storybook snapshot tests and Playwright E2E). It adds a step to install Chromium and its OS dependencies before the suite runs — the setup-chromium.mjs script that test:storybook and test:e2e call will then detect the binary as already present and skip the download:

```bash
cat .github/workflows/check-slow.yml
```

```output
name: Check Slow

on:
  pull_request:

jobs:
  check-slow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
        working-directory: frontend

      - name: Run slow checks
        run: npm run check:slow
```

No secrets are needed: the E2E suite points Next.js at an in-memory mock Supabase backend with hardcoded mock credentials, so the workflows run cleanly with no repository secrets configured.
