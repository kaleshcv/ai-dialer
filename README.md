# Dialer Combined

This repository contains two pieces that work together:

- a FastAPI backend for auth, campaigns, leads, metrics, and database access
- a browser SIP/WebRTC softphone that registers directly to your external Asterisk server from the tab

There is no ARI controller or worker-based originate path in the default runtime.

## Services

- `api`: FastAPI control plane with auth, campaigns, leads, and metrics
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

The backend still uses the usual database and auth settings in `.env`.
The browser softphone uses only these values:

```env
VITE_SIP_URI=sip:1001@172.16.50.45
VITE_SIP_PASSWORD=ecp!gen@20129
VITE_SIP_WS_URL=ws://172.16.50.45/ws
VITE_SIP_DISPLAY_NAME=Softphone 1001
```

If your Asterisk server exposes the built-in WebSocket directly, the URL is often `ws://172.16.50.45:8088/ws` instead.

## Backend API

The backend keeps campaign and lead management in the database.

- Create the first admin with `POST /api/v1/auth/bootstrap`
- Log in with `POST /api/v1/auth/login`
- Create and list campaigns with `POST /api/v1/campaigns` and `GET /api/v1/campaigns`
- Import leads with `POST /api/v1/leads/import`
- Campaign `start`, `pause`, and `resume` now only update campaign state in the database

API docs:

- `http://localhost:8000/docs`

Metrics:

- `http://localhost:8000/metrics`
- `ws://localhost:8000/ws/metrics`

## Browser Calling

The dialer tab contains a SIP.js softphone that registers directly to Asterisk from the browser.

1. Open `http://localhost:3000`
2. Go to the `Dialer Console`
3. Click `Connect`
4. Click `Register`
5. Enter a destination number and place the call

For successful browser audio:

- The Asterisk browser endpoint should be configured for WebRTC
- `direct_media=no` on that endpoint
- RTP UDP ports must be open on the Asterisk server
- The browser must have microphone and speaker permissions

## Notes

- The repo no longer depends on an ARI bridge or worker queue.
- The browser softphone talks directly to your external Asterisk server.
- Campaigns remain in the backend as database-managed records.
