# AccentAI Linux Migration Baseline

## Goal

Move the current Linux AccentAI call path toward a direct low-latency processing architecture without breaking the working UI flow:

- `System Mic` keeps sending raw microphone audio
- `AccentAI Mic` keeps sending accent-converted audio
- headset behavior should follow the OS/browser default device model
- live SIP calls should avoid the extra virtual-device recapture hop that currently adds delay

## Current Stable Baseline

This is the **working fallback path** and must remain available until the replacement path is proven.

### Browser UI

- File: `apps/web/src/components/BrowserVoicePanel.jsx`
- User-facing selector remains:
  - `System Mic`
  - `AccentAI Mic`
- `System Mic` uses the browser-selected system/default microphone.
- `AccentAI Mic` currently uses the Linux virtual input device `AccentAI_Mic`.

### Browser Device Selection Helpers

- File: `apps/web/src/lib/accentAi.js`
- Responsibilities:
  - query AccentAI backend status
  - start/stop AccentAI host
  - find browser-visible `AccentAI` virtual mic
  - find the preferred non-AccentAI system mic

### Backend Control

- File: `apps/api/app/api/v1/routes_accent_ai.py`
- File: `apps/api/app/services/accent_ai_service.py`
- Active control endpoints:
  - `GET /api/v1/accent-ai/info`
  - `POST /api/v1/accent-ai/start`
  - `POST /api/v1/accent-ai/stop`
  - `POST /api/v1/accent-ai/reset`
- Existing websocket endpoint:
  - `GET ws /api/v1/accent-ai/ws`

### Linux Audio Setup

- File: `scripts/setup-accentai-linux-audio.sh`
- Creates:
  - `AccentAI_Output`
  - `AccentAI_Mic`
- Keeps the user-facing labels clean:
  - `AccentAI Output`
  - `AccentAI Mic`
- Preserves or restores a physical/headset default sink and source for normal browser playback and capture.

### AccentAI Host Lifecycle

- File: `scripts/start-accentai-host.sh`
- File: `scripts/stop-accentai-host.sh`
- Responsibilities:
  - clean up stale AccentAI host and DSP workers
  - set PulseAudio environment
  - start AccentAI host in its own process group
  - stop the full process tree cleanly

## Current Call Path

### `System Mic`

`Browser mic -> WebRTC/SIP -> Asterisk/remote party`

### `AccentAI Mic`

`Browser selects AccentAI_Mic -> WebRTC/SIP -> Asterisk/remote party`

The converted device is populated by the Linux audio pipeline:

`Real mic -> AccentAI host -> AccentAI_Output -> AccentAI_Mic -> browser recaptures AccentAI_Mic`

## Why Delay Is Still ~3 Seconds

The current `AccentAI Mic` path adds multiple hops:

1. browser capture/device selection
2. PulseAudio source routing
3. Python AccentAI host
4. Node DSP process
5. PulseAudio virtual sink/source
6. browser recapture of `AccentAI_Mic`
7. WebRTC/SIP send

This path is stable enough to work, but it is not low-latency.

## Target Architecture

The target is to keep the same UI while changing only the call path internals.

### Target `System Mic`

`Browser default mic -> WebRTC/SIP`

### Target `AccentAI Mic`

`Browser default mic -> AccentAI realtime processor -> WebRTC/SIP outgoing audio track`

### Important Rule

The Linux virtual devices should become:

- fallback
- diagnostics
- optional preview path

They should **not** remain the required live-call path once the direct path is stable.

## Lessons From Failed Attempts

The first direct websocket attempt failed because it combined several risks at once:

- mismatched frame sizing
- backlog growth
- stale buffered audio
- fragile startup/session timing
- not enough telemetry to see where latency accumulated

Result:

- 5 to 10 second delay
- clipped words
- reduced clarity
- occasional raw/unprocessed voice

That path was rolled back on purpose.

## Safe Migration Rules

We will move in these steps:

1. Keep the current stable virtual-device path available at all times.
2. Introduce direct-call processing behind a clear seam, not across the whole UI.
3. Add telemetry before aggressive latency tuning.
4. Compare new path vs fallback on the same machine.
5. Promote the new path only after it beats the current path on:
   - latency
   - clarity
   - no clipped words
   - reliable switching

## Replacement Seam

The clean seam is inside `BrowserVoicePanel.jsx` where the outbound local stream is prepared for SIP.

Today:

- `System Mic`: capture raw chosen browser device
- `AccentAI Mic`: capture browser-visible `AccentAI_Mic`

Target:

- `System Mic`: unchanged
- `AccentAI Mic`: capture the same real mic as `System Mic`, but replace the outgoing SIP audio track with processed AccentAI audio

## Immediate Next Step

Step 1 is complete when the team agrees on the following baseline:

- keep the current UI
- keep the current virtual-device route as fallback
- build the next attempt only at the outbound SIP audio seam
- do not retune Linux/Pulse queues first
- do not retune DSP packet sizes first

## User Actions

For this documentation step: **no user action is needed**.

For the next implementation step, the likely user action will be:

- run one controlled before/after call test
- report rough delay bucket:
  - under 1 second
  - 1 to 2 seconds
  - 2+ seconds
- confirm whether words are clipped or clear
