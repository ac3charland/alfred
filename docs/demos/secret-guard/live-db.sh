#!/usr/bin/env bash
# Stand up a throwaway Postgres that demands a password (scram-sha-256), then query it through
# `npm run psql -w database` with DATABASE_URL carrying a fresh random password. Prints only
# what the query returns; the cluster and its data dir are removed on exit. NO_PASSWORD=1 leaves
# the password out of the URL, to show the server really does demand one.
set -euo pipefail

BIN=$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")
WORK=$(mktemp -d)
PORT=54329
PASSWORD=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')

as_pg() {
  if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$1"; else bash -c "$1"; fi
}
cleanup() {
  as_pg "'$BIN/pg_ctl' -D '$WORK/data' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

printf '%s\n' "$PASSWORD" > "$WORK/pw"
[ "$(id -u)" = 0 ] && chown -R postgres:postgres "$WORK"
as_pg "'$BIN/initdb' -D '$WORK/data' -U postgres -A scram-sha-256 --pwfile='$WORK/pw'" >/dev/null
as_pg "'$BIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses=127.0.0.1' -w start" >/dev/null

CREDENTIALS="postgres:$PASSWORD"
[ "${NO_PASSWORD:-}" = 1 ] && CREDENTIALS=postgres
DATABASE_URL="postgresql://$CREDENTIALS@127.0.0.1:$PORT/postgres" \
  npm run --silent psql -w database -- "$@"
