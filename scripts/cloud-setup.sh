#!/usr/bin/env bash
#
# Setup script for a Claude Code on the web custom environment (see
# docs/cloud-environment.md). Paste `bash scripts/cloud-setup.sh` into the
# environment's "Setup script" field, or inline this script's body.
#
# Runs as root in the environment's (cached) setup step, where apt is available,
# so it can install Chromium's OS libraries via `playwright install --with-deps`.
# This needs a network policy that allowlists Playwright's browser CDN
# (cdn.playwright.dev) — the default "Trusted" policy blocks it.
set -euo pipefail

npm ci

# `playwright install --with-deps` runs `apt-get update` across every configured apt
# source, including the deadsnakes / ondrej-php PPAs baked into the base image. Those
# PPAs occasionally rotate their Release file's Origin/Label/Suite (e.g. ondrej/php
# repointing to packages.sury.org) — apt treats that as a possible repo-swap attack and
# aborts with "Repository ... changed its 'Label' value" (exit 100) unless the change is
# acknowledged. Pre-accept it here so Playwright's own (flagless) `apt-get update`
# doesn't hit the same wall.
apt-get update --allow-releaseinfo-change -qq

# Real Playwright-managed Chromium + its system libraries. Idempotent: a warm
# cache re-uses the already-downloaded browser.
npm exec -w frontend -- playwright install --with-deps chromium

# Pre-pull the pinned Storybook-snapshot image so it's baked into the cached
# snapshot on disk (files persist across sessions; the daemon process does not —
# the `test:storybook` wrapper starts its own dockerd at gate time). This just
# makes that first run fast. `|| true` so a transient pull never blocks the
# session from starting; the gate would re-pull on demand anyway.
PW_VERSION="$(node -e "console.log(require('./frontend/node_modules/playwright/package.json').version)")"
dockerd >/tmp/dockerd-setup.log 2>&1 &
for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
docker pull "mcr.microsoft.com/playwright:v${PW_VERSION}-noble" || true
