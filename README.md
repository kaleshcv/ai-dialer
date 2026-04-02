# Dialer Combined

This repository contains:

- a FastAPI backend for auth, campaigns, leads, metrics, and AccentAI host control
- a browser SIP/WebRTC softphone that registers directly to your external Asterisk server

There is no ARI controller or worker-based originate path in the default runtime.

## Services

- `api`: FastAPI control plane plus AccentAI host-control APIs
- `web`: Vite + React dashboard with the browser softphone
- `postgres`: primary relational datastore
- `migrate`: one-shot schema migration service

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

If you need to apply the schema manually:

```bash
docker compose run --rm migrate
```

## Environment

The browser softphone uses:

```env
VITE_SIP_URI=sip:1001@172.16.50.45
VITE_SIP_PASSWORD=replace-me
VITE_SIP_WS_URL=ws://172.16.50.45/ws
VITE_SIP_DISPLAY_NAME=Softphone 1001
```

AccentAI host-control settings:

```env
ACCENTAI_DSP_ROOT=
ACCENTAI_DSP_NODE_BIN=node
ACCENTAI_DSP_SCRIPT=
ACCENTAI_DSP_WASM=
ACCENTAI_DSP_MODEL=
ACCENTAI_HOST_OUTPUT_NAME=AccentAI_Output
ACCENTAI_HOST_PID_FILE=
ACCENTAI_HOST_LOG_FILE=
ACCENTAI_HOST_START_SCRIPT=
ACCENTAI_HOST_STOP_SCRIPT=
ACCENTAI_HOST_SETUP_SCRIPT=
```

## AccentAI Linux Host Mode

AccentAI now runs in Linux host-control mode.

The intended flow is:

1. The backend starts the local AccentAI host service.
2. The host service captures the real system microphone.
3. AccentAI converts that mic audio locally.
4. Linux exposes the converted source back to the browser as an input device.
5. The browser softphone uses that converted input device like a normal microphone when `Start AccentAI` is enabled.

The repository includes these helper scripts:

- `scripts/setup-accentai-linux-audio.sh`
- `scripts/start-accentai-host.sh`
- `scripts/stop-accentai-host.sh`

The API expects the vendored AccentAI runtime here:

- `third_party/AccentAI/src/index.js`
- `third_party/AccentAI/assets/dsp.wasm`
- `third_party/AccentAI/assets/accent.model`

Important limitation:

- the browser can only use AccentAI when the converted source is actually visible to the OS/browser as an `audioinput` device
- this is a host-audio integration, not a pure browser-only transformation

## Backend API

Useful AccentAI endpoints:

- `GET /api/v1/accent-ai/info`
- `POST /api/v1/accent-ai/start`
- `POST /api/v1/accent-ai/stop`
- `POST /api/v1/accent-ai/reset`

Other backend API docs:

- `http://localhost:8000/docs`
- `http://localhost:8000/metrics`
- `ws://localhost:8000/ws/metrics`

## Browser Calling

The dialer tab contains a SIP.js softphone that registers directly to Asterisk from the browser.

1. Open `http://localhost:3000`
2. Go to `Dialer Console`
3. Click `Connect`
4. Click `Register`
5. Enter a destination number and place the call

To use AccentAI:

1. Make sure `third_party/AccentAI` is present
2. Make sure the Linux host scripts can create the converted source
3. Start the backend and web app
4. Click `Start AccentAI`
5. Place the browser call

When AccentAI is stopped, the browser falls back to the normal system microphone.

## Notes

- The repo no longer depends on an ARI bridge or worker queue.
- The browser softphone talks directly to your external Asterisk server.
- Campaigns remain backend-managed records.
- AccentAI control is now host-driven; the browser no longer needs to stream live conversion audio through the app for normal calling.
