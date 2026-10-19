#!/usr/bin/env sh
# For cron: switch into the project folder (so .env is found) and run once.
cd "$(dirname "$0")" || exit 1
mkdir -p out
exec "${BUN:-$HOME/.bun/bin/bun}" run src/main.ts >> out/run.log 2>&1
