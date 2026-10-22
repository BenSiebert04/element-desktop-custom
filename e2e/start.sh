#!/usr/bin/env bash
# Starts Synapse, LiveKit, lk-jwt-service and a static server for Element Call.
set -euo pipefail
cd "$(dirname "$0")/.work"
nohup ./venv/bin/python -m synapse.app.homeserver -c hs/hs.yaml > synapse.log 2>&1 &
echo $! > pids
nohup ./livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1 > livekit.log 2>&1 &
echo $! >> pids
LIVEKIT_URL=ws://localhost:7880 LIVEKIT_KEY=devkey LIVEKIT_SECRET=secret \
LIVEKIT_JWT_BIND=127.0.0.1:6080 LIVEKIT_FULL_ACCESS_HOMESERVERS='*' \
LIVEKIT_INSECURE_SKIP_VERIFY_TLS=YES_I_KNOW_WHAT_I_AM_DOING \
    nohup ./lk-jwt-service > jwt.log 2>&1 &
echo $! >> pids
nohup node ../serve.mjs "$PWD/ec" 8080 > serve.log 2>&1 &
echo $! >> pids
for i in $(seq 1 30); do
    curl -fs http://localhost:8008/_matrix/client/versions >/dev/null && break
    sleep 1
done
echo "Backend running: Element Call on http://localhost:8080"
