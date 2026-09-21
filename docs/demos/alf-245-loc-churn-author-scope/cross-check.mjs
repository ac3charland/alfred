// Cross-checks the chart's week of 13 Sep 2026 against GitHub's own raw answers, committed
// beside this script: the two `stats/contributors` payloads the chart reads, and the pull
// requests merged into those repos that week. No network, no app — just GitHub's numbers.
import { readFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, HERE), 'utf8'));

const WEEK = Date.parse('2026-09-13T00:00:00Z') / 1000;
const ALLOWLIST = ['ac3charland']; // PR_RATIO_AUTHORS — the logins that OPEN pull requests.
const churn = (w) => w.a + w.d;

for (const repo of ['alfred', 'realplay']) {
  for (const row of read(`github-stats-${repo}.json`)) {
    const week = row.weeks.find((w) => w.w === WEEK);
    if (week === undefined || churn(week) === 0) continue;
    console.log(
      `${repo.padEnd(9)} commit author ${String(row.author?.login).padEnd(12)}` +
        ` +${String(week.a).padStart(6)} -${String(week.d).padStart(5)}` +
        ` = ${String(churn(week)).padStart(6)} lines`,
    );
  }
}

const total = (keep) =>
  ['alfred', 'realplay']
    .flatMap((repo) => read(`github-stats-${repo}.json`))
    .filter((row) => keep(row.author?.login ?? null))
    .reduce((sum, row) => sum + (row.weeks.find((w) => w.w === WEEK)?.a ?? 0)
      + (row.weeks.find((w) => w.w === WEEK)?.d ?? 0), 0);

console.log('');
console.log(`bar drawn BEFORE the fix (allowlisted PR openers only): ${total((l) => ALLOWLIST.includes(l))}`);
console.log(`bar drawn AFTER  the fix (every non-bot commit author): ${total(() => true)}`);

console.log('');
console.log('Pull requests actually merged into those repos that week:');
let merged = 0;
for (const pr of read('merged-prs-week-2026-09-13.json')) {
  merged += pr.additions + pr.deletions;
  console.log(
    `  ${pr.repo.padEnd(9)} #${String(pr.number).padEnd(4)} opened by ${pr.pr_author.padEnd(12)}` +
      ` +${String(pr.additions).padStart(6)} -${String(pr.deletions).padStart(5)}  ${pr.title.slice(0, 42)}`,
  );
}
console.log(`  ${String(read('merged-prs-week-2026-09-13.json').length).padStart(2)} merged PRs, ${merged} lines of net diff — one of them alone is 12,287.`);
