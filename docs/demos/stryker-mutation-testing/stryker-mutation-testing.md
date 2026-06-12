# Stryker mutation testing across the alfred workspaces

*2026-06-10T21:10:15.537Z*

Mutation testing grades the *assertions* in our test suite, not just line coverage. Stryker (StrykerJS v9) makes small, deliberate breakages ("mutants") in source — `a + b` -> `a - b`, `??` -> `&&`, `'x'` -> `''` — then runs the covering tests. A mutant that makes a test fail is *killed* (good); one that leaves every test green *survived* (a real bug would ship green there). This doc sets Stryker up in all three code packages and runs it against a single file.

```node
console.log('@stryker-mutator/core@' + require('@stryker-mutator/core/package.json').version); console.log('@stryker-mutator/jest-runner@' + require('@stryker-mutator/jest-runner/package.json').version)
```

```output
@stryker-mutator/core@9.6.1
@stryker-mutator/jest-runner@9.6.1
```

Each code package owns its own `stryker.config.json` (wired to that package's `jest.config.ts`) and a standalone `npm run mutation` script. It is deliberately NOT in `check:fast` / `check:slow` — mutation testing re-runs the suite once per mutant, so it's an occasional audit, not a per-commit gate.

```node
for (const p of ['frontend','workers','tools/showboat']) { const pkg=require('./'+p+'/package.json'); const cfg=require('./'+p+'/stryker.config.json'); console.log(p+': mutation='+JSON.stringify(pkg.scripts.mutation)+' testRunner='+cfg.testRunner+' coverageAnalysis='+cfg.coverageAnalysis); }
```

```output
frontend: mutation="stryker run" testRunner=jest coverageAnalysis=perTest
workers: mutation="stryker run" testRunner=jest coverageAnalysis=perTest
tools/showboat: mutation="stryker run" testRunner=jest coverageAnalysis=perTest
```

Now the single-file verification. `frontend/lib/tree.ts` is pure adjacency-list logic (`buildTree` / `collectSubtree` / `makeOptimisticItem`) with a thorough co-located test — an ideal mutation target. Running `npm run mutation -w frontend -- --mutate lib/tree.ts` (the `--mutate` flag overrides the config's globs for a fast single-file loop) produced:

| metric | value |
| --- | --- |
| mutation score (all mutants) | 87.65% |
| mutation score (covered code) | 88.75% |
| killed | 67 |
| timeout (counts as killed) | 4 |
| survived | 9 |
| no coverage | 1 |
| runtime/compile errors | 0 |

The 9 survivors are precise, actionable assertion gaps. Example — `[Survived] LogicalOperator` at `lib/tree.ts:124`, where `notes: input.notes ?? null` was mutated to `input.notes && null` and every test stayed green, because no `makeOptimisticItem` test passes a non-null `notes`. Coverage alone would never surface that; mutation testing points straight at it.

```bash
npm run mutation -w frontend -- --mutate lib/tree.ts >/dev/null 2>&1 && echo 'stryker run completed with exit code 0 (thresholds.break=null, so survived mutants are reported but do not fail the run)'
```

```output
stryker run completed with exit code 0 (thresholds.break=null, so survived mutants are reported but do not fail the run)
```

To reproduce: `npm run mutation -w frontend` (whole package, uses the config's `mutate` globs) or `npm run mutation -w frontend -- --mutate <file>` for one file; swap `-w frontend` for `-w workers` or `-w tools/showboat`. After a run, open the HTML report at `frontend/reports/mutation/mutation.html` to browse every survived mutant by file and line. The `.stryker-tmp/` sandbox is auto-cleaned, and the sandbox + `reports/mutation/` are git/prettier/eslint-ignored. See the `stryker` skill for the mental model, the coverageAnalysis decision tree, and the npm-workspaces sandbox gotcha.
