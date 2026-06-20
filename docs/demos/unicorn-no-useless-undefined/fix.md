---
branch: claude/unicorn-no-useless-undefined-4u44ik
---

# unicorn/no-useless-undefined: allow mockResolvedValue(undefined) in test files

*2026-06-20T03:57:58.063Z*

The unicorn/no-useless-undefined rule was auto-fixing mockResolvedValue(undefined) to mockResolvedValue() in test files, which then broke TypeScript (TS2554: Expected 1 argument, but got 0). The fix adds checkArguments: false for test files only, so the argument is preserved.

```bash
npm run lint -w frontend 2>&1 | grep -E '(error|warning|passed|failed|mockResolvedValue|✖|✓)' | head -20
```

```output
  23:9  warning  Unexpected use of page.waitForTimeout()  playwright/no-wait-for-timeout
✖ 1 problem (0 errors, 1 warning)
```

The reverted test files now use mockResolvedValue(undefined) again. ESLint no longer strips the argument — the pattern survives the lint step unchanged:

```bash
grep 'mockResolvedValue' frontend/lib/hooks/use-inline-edit.test.tsx frontend/components/atoms/editable-text-field.test.tsx
```

```output
frontend/lib/hooks/use-inline-edit.test.tsx:    const onSave = jest.fn().mockResolvedValue(undefined);
frontend/lib/hooks/use-inline-edit.test.tsx:    const onSave = jest.fn().mockResolvedValue(undefined);
frontend/components/atoms/editable-text-field.test.tsx:    const onSave = jest.fn().mockResolvedValue(undefined);
frontend/components/atoms/editable-text-field.test.tsx:    const onSave = jest.fn().mockResolvedValue(undefined);
```

After running eslint --fix (the lint step of check:fast), the undefined argument is preserved — no auto-fix strips it:

```bash
npm run lint -w frontend 2>&1 | grep -E '(error|warning|✖)' && grep 'mockResolvedValue' frontend/lib/hooks/use-inline-edit.test.tsx frontend/components/atoms/editable-text-field.test.tsx
```

```output
  23:9  warning  Unexpected use of page.waitForTimeout()  playwright/no-wait-for-timeout
✖ 1 problem (0 errors, 1 warning)
frontend/lib/hooks/use-inline-edit.test.tsx:    const onSave = jest.fn().mockResolvedValue(undefined);
frontend/lib/hooks/use-inline-edit.test.tsx:    const onSave = jest.fn().mockResolvedValue(undefined);
frontend/components/atoms/editable-text-field.test.tsx:    const onSave = jest.fn().mockResolvedValue(undefined);
frontend/components/atoms/editable-text-field.test.tsx:    const onSave = jest.fn().mockResolvedValue(undefined);
```
