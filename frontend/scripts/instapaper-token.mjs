// One-off: trade the owner's Instapaper username/password for the access token pair the Reader's
// send verb signs with. Prints the pair; stores nothing (Instapaper's API terms allow a password
// only for this exchange). Run as `npm run instapaper:token -w frontend`.
//
// It reuses the app's own signer (`lib/instapaper/xauth.ts` → `oauth.ts`) rather than keeping a
// second one, so it runs the TypeScript directly: Node strips the types, the `react-server`
// condition (set by the npm script) resolves `server-only` to its empty module, and the resolve
// hook below maps the app's `@/` alias onto this package.
import { registerHooks } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(
        pathToFileURL(path.resolve(root, `${specifier.slice(2)}.ts`)).href,
        context,
      );
    }
    if (
      specifier.startsWith('.') &&
      context.parentURL?.endsWith('.ts') &&
      !/\.\w+$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { exchangeForAccessToken } = await import('../lib/instapaper/xauth.ts');

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY,
});
const lines = rl[Symbol.asyncIterator]();
let muted = false;
// Keep the password off the screen: once the prompt is written, swallow the echoed keystrokes.
const write = rl._writeToOutput?.bind(rl);
if (write) {
  rl._writeToOutput = (text) => {
    if (!muted) write(text);
  };
}

async function ask(prompt, { secret = false } = {}) {
  process.stdout.write(prompt);
  muted = secret;
  const { value, done } = await lines.next();
  muted = false;
  if (secret) process.stdout.write('\n');
  if (done || value === undefined) throw new Error('input ended early');
  return value.trim();
}

try {
  const apiUrl = process.env.INSTAPAPER_API_URL?.trim() || 'https://www.instapaper.com';
  const consumerKey = await ask('Consumer key: ');
  const consumerSecret = await ask('Consumer secret: ', { secret: true });
  const username = await ask('Instapaper username (email): ');
  const password = await ask('Instapaper password: ', { secret: true });

  const { token, tokenSecret } = await exchangeForAccessToken({
    apiUrl,
    consumerKey,
    consumerSecret,
    username,
    password,
  });
  process.stdout.write(
    `\nSet these on the deployment (server-side only), beside the consumer pair:\n` +
      `INSTAPAPER_ACCESS_TOKEN=${token}\nINSTAPAPER_ACCESS_TOKEN_SECRET=${tokenSecret}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
}
