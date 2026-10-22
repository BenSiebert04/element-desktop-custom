#!/usr/bin/env bash
# Sets up a local, throw-away MatrixRTC backend for end-to-end tests of the
# custom call layout: Synapse (pip), LiveKit SFU and lk-jwt-service (pinned
# release binaries, checksums verified) and a standalone Element Call build.
# Linux x64 only. Everything lives in e2e/.work (git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
WORK="$PWD/.work"
mkdir -p "$WORK" && cd "$WORK"

LIVEKIT_VERSION=1.13.10
LIVEKIT_SHA256=c25a3e45fb922e9a93c6443d10c0ed041ba64342097e38632331736630283165
JWT_VERSION=0.9.0
JWT_SHA256=bb0e23dc8ae3d256a51cb70cfc7551b0023e8c4cbcf02bad55d62a546b1afe35
SYNAPSE_VERSION=1.163.0

if [ ! -x livekit-server ]; then
    curl -fsSL -o lk.tgz "https://github.com/livekit/livekit/releases/download/v$LIVEKIT_VERSION/livekit_${LIVEKIT_VERSION}_linux_amd64.tar.gz"
    echo "$LIVEKIT_SHA256  lk.tgz" | sha256sum -c -
    tar xzf lk.tgz livekit-server && rm lk.tgz
fi
if [ ! -x lk-jwt-service ]; then
    curl -fsSL -o lk-jwt-service "https://github.com/element-hq/lk-jwt-service/releases/download/v$JWT_VERSION/lk-jwt-service_linux_amd64"
    echo "$JWT_SHA256  lk-jwt-service" | sha256sum -c -
    chmod +x lk-jwt-service
fi
if [ ! -d venv ]; then
    python3 -m venv venv
    ./venv/bin/pip install -q "matrix-synapse==$SYNAPSE_VERSION" pyyaml
fi

# Synapse: server name "localhost:8448" so that lk-jwt-service can verify
# OpenID tokens over (self-signed) TLS; clients use plain HTTP on :8008.
if [ ! -f hs/hs.yaml ]; then
    mkdir -p hs
    openssl req -x509 -newkey rsa:2048 -nodes -keyout hs/tls.key -out hs/tls.crt -days 30 \
        -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
    ./venv/bin/python -m synapse.app.homeserver --server-name localhost:8448 \
        --config-path hs/hs.yaml --data-directory "$WORK/hs" --generate-config --report-stats=no
    ./venv/bin/python - "$WORK/hs" <<'PY'
import sys, yaml
d = sys.argv[1]
p = f"{d}/hs.yaml"
c = yaml.safe_load(open(p))
c.update({
    "listeners": [
        {"port": 8008, "tls": False, "type": "http", "bind_addresses": ["127.0.0.1"],
         "resources": [{"names": ["client", "openid"], "compress": False}]},
        {"port": 8448, "tls": True, "type": "http", "bind_addresses": ["127.0.0.1"],
         "resources": [{"names": ["client", "federation", "openid"], "compress": False}]},
    ],
    "tls_certificate_path": f"{d}/tls.crt",
    "tls_private_key_path": f"{d}/tls.key",
    "public_baseurl": "http://localhost:8008/",
    "enable_registration": True,
    "enable_registration_without_verification": True,
    "max_event_delay_duration": "24h",
    # Element Call's standalone room creation predates room version 12
    "default_room_version": "10",
    "experimental_features": {"msc3266_enabled": True, "msc4222_enabled": True},
    "rc_message": {"per_second": 100, "burst_count": 1000},
    "rc_registration": {"per_second": 100, "burst_count": 1000},
    "rc_room_creation": {"per_second": 100, "burst_count": 1000},
    "rc_joins": {"local": {"per_second": 100, "burst_count": 1000},
                 "remote": {"per_second": 100, "burst_count": 1000}},
    "rc_login": {"address": {"per_second": 100, "burst_count": 1000},
                 "account": {"per_second": 100, "burst_count": 1000}},
    "trusted_key_servers": [],
    "suppress_key_server_warning": True,
    "report_stats": False,
})
yaml.safe_dump(c, open(p, "w"))
PY
fi

# Standalone Element Call build of this repository
(cd ../../element-call && NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/vite build --outDir "$WORK/ec")
cat > ec/config.json <<'JSON'
{
  "default_server_config": {
    "m.homeserver": { "base_url": "http://localhost:8008", "server_name": "localhost:8448" }
  },
  "livekit": { "livekit_service_url": "http://localhost:6080" },
  "matrix_rtc_mode": "compatibility",
  "matrix_rtc_session": { "wait_for_key_rotation_ms": 3000, "membership_event_expiry_ms": 180000000, "network_error_retry_ms": 100 }
}
JSON
echo "Setup complete. Start the backend with e2e/start.sh"
