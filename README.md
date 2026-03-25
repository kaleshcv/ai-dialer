# Dialer Combined

`dialer-combined` is the merged codebase built from phases 1 through 5. It keeps the working campaign/lead pipeline from the earlier phase, adds tenant-aware auth and JWT issuance, restores supervisor metrics and dashboard flows, and carries forward the ARI + Asterisk service split for call origination.

## Services

- `api`: FastAPI control plane with auth, campaigns, leads, metrics, and supervisor endpoints
- `worker`: Celery worker for predictive launch decisions and outbound origination
- `beat`: Celery beat scheduler for active-campaign dispatch and retry scans
- `ari-controller`: FastAPI ARI bridge plus background event consumer
- `web`: Vite + React supervisor and agent control room
- `postgres`: primary relational datastore
- `redis`: Celery broker/backend
- `Asterisk`: your external telephony server

## Quick start

```bash
cp .env.example .env
docker compose up --build -d
```

`docker compose up --build -d` starts the stack in the background.
If you want the foreground log stream, run `docker compose up --build` instead.
The Python services also run as a non-root user by default using `APP_UID` and `APP_GID`.

If you switch databases or need to re-apply the schema manually, run:

```bash
docker compose run --rm migrate
```

Database selection defaults to `DATABASE_MODE=auto`, which prefers a host PostgreSQL server when one is reachable and otherwise falls back to the Docker `postgres` service. The compose stack no longer binds host port `5432`, so it can coexist with a locally running PostgreSQL instance.

To force a specific database target, set one of these values in `.env` before starting the stack:

- `DATABASE_MODE=host` to always use the host PostgreSQL instance
- `DATABASE_MODE=docker` to always use the Docker `postgres` service
- `DATABASE_MODE=direct` to use `DATABASE_URL` exactly

If you need to override the host database address, set `HOST_POSTGRES_HOST`. Leave it blank to use `127.0.0.1` for local runs and `host.docker.internal` from inside the containers.

## First bootstrap

Create the first tenant admin:

```bash
curl -X POST http://localhost:8000/api/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_name": "Acme Contact Center",
    "timezone": "Asia/Kolkata",
    "admin_full_name": "Dialer Admin",
    "admin_email": "admin@example.com",
    "password": "ChangeMe123!"
  }'
```

Then create a campaign, import leads, and start dialing:

```bash
curl -X POST http://localhost:8000/api/v1/campaigns \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": 1,
    "name": "Demo Campaign",
    "dialing_mode": "predictive",
    "max_concurrent_lines": 10,
    "retry_attempts": 3,
    "caller_id": "1000"
  }'
```

```bash
curl -X POST http://localhost:8000/api/v1/leads/import \
  -H 'Content-Type: application/json' \
  -d '{
    "campaign_id": 1,
    "leads": [
      {"full_name": "Alice", "phone_number": "919900000001", "timezone": "Asia/Kolkata"},
      {"full_name": "Bob", "phone_number": "919900000002", "timezone": "Asia/Kolkata"}
    ]
  }'
```

```bash
curl -X POST http://localhost:8000/api/v1/campaigns/1/start
```

## Endpoints

- API docs: `http://localhost:8000/docs`
- Metrics feed: `http://localhost:8000/metrics`
- Metrics websocket: `ws://localhost:8000/ws/metrics`
- Web dashboard: `http://localhost:3000`
- Asterisk ARI: `http://172.16.50.45:8088/ari`

## Placing a call from the UI

Open `http://localhost:3000`, stay on the `Dialer Console` workspace, and use the `Launch test call` launchpad:

1. Select a campaign.
2. Enter the destination phone number.
3. Optionally override the caller ID.
4. Click `Launch test call`.

That button queues the backend manual-call API, which creates a lead and asks the worker to originate through API → worker → ARI → your external Asterisk.

## Browser voice calls

The same dialer page now also has a SIP.js browser softphone panel. That panel uses the `VITE_SIP_URI`, `VITE_SIP_PASSWORD`, and `VITE_SIP_WS_URL` values from `.env` to register directly against your external Asterisk WebSocket and place a live call from the tab.
Use the websocket shape your Asterisk actually exposes: `ws://host/ws` if you are going through a reverse proxy, or `ws://host:8088/ws` if you are connecting to the built-in Asterisk HTTP server directly.
The bundled `infra/asterisk` folder is not required for this mode; it only exists for the optional local Asterisk setup.

1. Open `http://localhost:3000`.
2. In the `Browser Voice` panel, click `Connect`.
3. Click `Register` if you want the browser endpoint registered for incoming calls.
4. Enter or reuse the destination number.
5. Click `Call from browser`.

## Call prerequisites

- The stack must be running: `docker compose up --build -d`, or `docker compose up --build` if you want it attached
- Migrations must have completed successfully
- At least one campaign must exist for the backend originate path
- `SIP_TRUNK_ENDPOINT` in `.env` must point to a working trunk on your external Asterisk server
- `ARI_BASE_URL`, `ARI_WS_URL`, `ARI_USERNAME`, `ARI_PASSWORD`, and `ARI_APP_NAME` in `.env` must match your external Asterisk ARI configuration
- `VITE_SIP_URI`, `VITE_SIP_PASSWORD`, and `VITE_SIP_WS_URL` in `.env` must match the browser endpoint and WebSocket URL on your external Asterisk server
- Your outbound destination must be dialable by the configured trunk
- Set `VERBOSE_DOCKER_LOGS=true` if you want the API, worker, beat, and ARI controller logs to appear in `docker compose` output again
- If the browser call connects but audio is silent, SIP signaling is working but the RTP media path is not. Check that the external Asterisk server allows the RTP UDP port range, has the browser endpoint configured for WebRTC, and permits `ulaw` or `alaw`.

For `SIP_TRUNK_ENDPOINT`, the most common setting is `PJSIP/mytrunk-endpoint`. The ARI controller will turn that into `PJSIP/<number>@mytrunk-endpoint` when it places a call. If you need a custom request URI, you can also use `PJSIP/{phone}@mytrunk-endpoint` or `PJSIP/mytrunk-endpoint/sip:{phone}@your-sbc.example.com`.

The browser softphone uses `ws://172.16.50.45/ws` in the current `.env`. If you deploy the UI over HTTPS, switch that to `wss://...` and keep the Asterisk transport aligned.

## Notes

- This is a production-oriented starter, not a drop-in enterprise dialer.
- ARI barge/whisper controls are exposed at the API layer but still need real media-control wiring for live coaching.
- Replace placeholder SIP trunk and ARI credentials before attempting real outbound traffic.
- The worker now records origination failures and schedules retries instead of auto-retrying the side-effecting call task itself.
