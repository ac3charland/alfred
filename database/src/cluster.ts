import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * A running throwaway PostgreSQL cluster: its own data dir on an ephemeral port,
 * trust auth, torn down (server stopped + dir removed) by {@link Cluster.stop}.
 * Connect a `pg` client to `{ host, port, user, database }` — no password.
 */
export interface Cluster {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly database: string;
  readonly stop: () => void;
}

// initdb/postgres refuse to run as root, so when we're root we run the server as the
// `postgres` system user (the CI runner is non-root and runs everything as itself).
const RUNNING_AS_ROOT = (process.getuid?.() ?? 1) === 0;

/** Run a shell command, as the `postgres` user when we're root. Throws on failure unless `allowFail`. */
function run(command: string, allowFail = false): void {
  const result = RUNNING_AS_ROOT
    ? spawnSync('su', ['postgres', '-s', '/bin/bash', '-c', command], { encoding: 'utf8' })
    : spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  if (!allowFail && (result.status ?? 1) !== 0) {
    throw new Error(
      `command failed (${command}):\n${result.stderr || (result.error?.message ?? 'unknown error')}`,
    );
  }
}

/**
 * The directory holding `initdb`/`pg_ctl`. They aren't always on `PATH` (Debian/Ubuntu
 * keep them under `/usr/lib/postgresql/<major>/bin`), so look there too, newest major first.
 */
function findServerBinDir(): string {
  const onPath = spawnSync('bash', ['-c', 'command -v initdb'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim().length > 0) {
    return path.dirname(onPath.stdout.trim());
  }
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    let newest = -1;
    for (const entry of readdirSync(base)) {
      const major = Number.parseInt(entry, 10);
      if (Number.isFinite(major) && major > newest) newest = major;
    }
    if (newest >= 0) {
      const dir = path.join(base, String(newest), 'bin');
      if (existsSync(path.join(dir, 'initdb'))) return dir;
    }
  }
  throw new Error(
    'PostgreSQL server binaries (initdb/pg_ctl) not found. Install the postgresql server package (e.g. `apt-get install postgresql`).',
  );
}

/** An unused TCP port on the loopback interface, so concurrent clusters never collide. */
async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('could not determine a free port'));
        });
        return;
      }
      const { port } = address;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** Initialize and start a hermetic PostgreSQL cluster; the returned {@link Cluster} owns its teardown. */
export async function startCluster(): Promise<Cluster> {
  const binDir = findServerBinDir();
  const port = await freePort();
  const work = mkdtempSync(path.join(tmpdir(), 'alfred-pg-'));
  const data = path.join(work, 'data');

  // The server processes (run as `postgres` when we're root) need to own the data dir.
  spawnSync('mkdir', ['-p', data]);
  if (RUNNING_AS_ROOT) spawnSync('chown', ['-R', 'postgres:postgres', work]);

  run(`${binDir}/initdb -D ${data} -U postgres --auth=trust`);
  run(
    `${binDir}/pg_ctl -D ${data} -o "-p ${String(port)} -h 127.0.0.1 -k ${work}" -l ${work}/server.log -w start`,
  );

  return {
    host: '127.0.0.1',
    port,
    user: 'postgres',
    database: 'postgres',
    stop: () => {
      run(`${binDir}/pg_ctl -D ${data} stop -m immediate`, true);
      rmSync(work, { recursive: true, force: true });
    },
  };
}
