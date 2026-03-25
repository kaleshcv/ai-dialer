import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from threading import Lock, Thread
from urllib.parse import urlencode
import websocket
from ari_app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class AriWebsocketStatus:
    state: str = 'connecting'
    ws_url: str = settings.ARI_WS_URL
    last_error: str | None = None
    last_error_at: str | None = None
    last_close_code: int | None = None
    last_close_message: str | None = None
    last_close_at: str | None = None
    last_connected_at: str | None = None
    last_event_at: str | None = None


STATUS = AriWebsocketStatus()
STATUS_LOCK = Lock()


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update_status(**changes) -> None:
    with STATUS_LOCK:
        for key, value in changes.items():
            setattr(STATUS, key, value)
        STATUS.last_event_at = _timestamp()


def get_websocket_status() -> dict:
    with STATUS_LOCK:
        return asdict(STATUS)


def detect_amd(event: dict) -> str:
    payload = json.dumps(event).lower()
    if 'machine' in payload:
        return 'machine'
    return 'human'


def on_message(ws, message):
    try:
        event = json.loads(message)
    except Exception:
        logger.exception('Failed to parse ARI event')
        return
    logger.info('ARI event: %s', event.get('type'))
    if event.get('type') == 'ChannelTalkingStarted':
        logger.info('AMD guess: %s', detect_amd(event))


def on_error(ws, error):
    error_message = str(error).strip() or error.__class__.__name__
    logger.error('ARI websocket error: %s', error_message)
    _update_status(state='error', last_error=error_message, last_error_at=_timestamp())


def on_close(ws, close_status_code, close_msg):
    logger.warning('ARI websocket closed: %s %s', close_status_code, close_msg)
    _update_status(
        state='reconnecting',
        last_close_code=close_status_code,
        last_close_message=str(close_msg).strip() if close_msg is not None else None,
        last_close_at=_timestamp(),
    )


def on_open(ws):
    logger.info('Connected to ARI websocket')
    _update_status(
        state='connected',
        last_error=None,
        last_error_at=None,
        last_close_code=None,
        last_close_message=None,
        last_close_at=None,
        last_connected_at=_timestamp(),
    )


def run_forever():
    qs = urlencode({'app': settings.ARI_APP_NAME, 'api_key': f'{settings.ARI_USERNAME}:{settings.ARI_PASSWORD}'})
    while True:
        try:
            _update_status(state='connecting', ws_url=settings.ARI_WS_URL)
            ws = websocket.WebSocketApp(
                f'{settings.ARI_WS_URL}?{qs}',
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                on_open=on_open,
            )
            ws.run_forever(ping_interval=30, ping_timeout=10, suppress_origin=True)
        except Exception:
            logger.exception('ARI websocket loop crashed')
            _update_status(
                state='error',
                last_error='ARI websocket loop crashed',
                last_error_at=_timestamp(),
            )
        finally:
            with STATUS_LOCK:
                if STATUS.state != 'connected':
                    STATUS.state = 'reconnecting'
                    STATUS.last_event_at = _timestamp()
        time.sleep(settings.ARI_EVENT_RECONNECT_SECONDS)


def start_background_consumer() -> Thread:
    thread = Thread(target=run_forever, daemon=True)
    thread.start()
    return thread
