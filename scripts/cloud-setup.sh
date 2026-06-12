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

# Real Playwright-managed Chromium + its system libraries. Idempotent: a warm
# cache re-uses the already-downloaded browser.
npm exec -w frontend -- playwright install --with-deps chromium
