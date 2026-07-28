// What PR 247's merge does once the merged Worker is actually the deployed one.
//
// The real `handleWebhook`, driven by PR 247's real payload through a signed request, with
// Supabase and the GitHub Contents API stubbed so every outbound write is visible.
import { deliver } from './worker-harness.mjs';

for (const event of [
  { action: 'opened', merged: false },
  { action: 'closed', merged: true },
]) {
  const { status, text, calls } = await deliver(event);
  const label = `pull_request.${event.action}${event.merged ? ' (merged)' : ''}`;
  console.log(`── ${label} → ${String(status)} ${text}`);
  for (const call of calls) {
    console.log(`     ${call.url}`);
    if (call.body !== undefined) console.log(`       ${call.body}`);
  }
  console.log();
}
