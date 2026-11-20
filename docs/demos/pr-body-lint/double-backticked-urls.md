---
branch: claude/ci-check-double-backticks-urls-e9orvs
---

# PR body check: double-backticked URLs fail CI

*2026-11-20T02:50:32.838Z*

ALF-332. A PR description that wraps a URL in double backticks renders the URL as inline code, so the link is dead. The new PR body workflow pipes the description into tools/pr-body-lint, which fails the check. The edited event re-runs it when only the description changes. Below, the linter runs on the broken shape from PR #311, on a correct link, and on the broken shape quoted inside a fenced block (which is skipped).

```bash
printf "%s\n" "📝 **Demo:** [demo.md](\`\`https://github.com/o/r/blob/b/docs/demos/x/demo.md\`\`)" | npm run --silent lint:pr-body -w tools/pr-body-lint; echo "exit $?"
```

```output
  ✗ error [double-backticked-url] line 1: https://github.com/o/r/blob/b/docs/demos/x/demo.md is wrapped in double backticks, so it renders as code, not a link. Remove the backticks.

pr-body-lint: 1 error(s).
exit 1
```

```bash
printf "%s\n" "📝 **Demo:** [demo.md](https://github.com/o/r/blob/b/docs/demos/x/demo.md)" "Paste a URL like \`https://example.com/feed.xml\`." | npm run --silent lint:pr-body -w tools/pr-body-lint; echo "exit $?"
```

```output

pr-body-lint: 0 error(s).
exit 0
```

```bash
printf "%s\n" "\`\`\`md" "[x](\`\`https://example.com\`\`)" "\`\`\`" | npm run --silent lint:pr-body -w tools/pr-body-lint; echo "exit $?"
```

```output

pr-body-lint: 0 error(s).
exit 0
```

A multi-line body: a bare double-backticked URL on line 3, a double-backticked root-relative link target on line 5 (the form the demo pr-link emits), and a triple-backtick inline code span on line 1 that must not swallow the rest of the body as a fence. Each finding names its line.

```bash
printf "%s\n" "\`\`\`npm ci\`\`\` runs first." "" "Findings: \`\`https://example.com/findings.html\`\`" "" "📝 [demo.md](\`\`/o/r/blob/b/docs/demos/x/demo.md\`\`)" | npm run --silent lint:pr-body -w tools/pr-body-lint; echo "exit $?"
```

```output
  ✗ error [double-backticked-url] line 3: https://example.com/findings.html is wrapped in double backticks, so it renders as code, not a link. Remove the backticks.
  ✗ error [double-backticked-url] line 5: /o/r/blob/b/docs/demos/x/demo.md is wrapped in double backticks, so it renders as code, not a link. Remove the backticks.

pr-body-lint: 2 error(s).
exit 1
```
