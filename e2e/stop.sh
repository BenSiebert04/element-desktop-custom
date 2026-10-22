#!/usr/bin/env bash
cd "$(dirname "$0")/.work" && xargs -r kill < pids && rm pids
