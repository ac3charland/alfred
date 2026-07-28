// The health route now names the build it is running, so "is production current?" stops being
// guesswork. The real `worker.fetch`, called twice: once with the var CI injects, once without.
import { ENV, workerModule } from './worker-harness.mjs';

const ctx = { waitUntil: () => {} };
const health = async (env) => {
  const response = await workerModule.default.fetch(new Request('https://worker.dev/'), env, ctx);
  return response.text();
};

console.log('deployed by CI   :', await health({ ...ENV, WORKER_VERSION: '10d3928' }));
console.log('deployed by hand :', await health(ENV));
