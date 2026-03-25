import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from ari_app.call_controller import originate_customer_call
from ari_app.config import settings
from ari_app.event_consumer import get_websocket_status, start_background_consumer
from ari_app.schemas import OriginateRequest


def _configure_logging(verbose: bool) -> None:
    level = logging.INFO if verbose else logging.WARNING
    logging.getLogger().setLevel(level)
    logging.getLogger('ari_app').setLevel(level)
    logging.getLogger('uvicorn.error').setLevel(level)
    logging.getLogger('uvicorn.access').setLevel(level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _configure_logging(settings.VERBOSE_DOCKER_LOGS)
    start_background_consumer()
    yield


app = FastAPI(title='ARI Controller', version='0.1.0', lifespan=lifespan)


@app.get('/health')
def health():
    websocket_status = get_websocket_status()
    service_status = 'ok' if websocket_status.get('state') == 'connected' else 'degraded'
    return {
        'status': service_status,
        'service': 'ari-controller',
        'websocket': websocket_status,
    }


@app.post('/originate')
def originate(payload: OriginateRequest):
    result = originate_customer_call(
        phone_number=payload.phone_number,
        metadata={
            'campaign_id': payload.campaign_id,
            'lead_id': payload.lead_id,
            'caller_id': payload.caller_id,
        },
    )
    return {
        'status': 'requested',
        'campaign_id': payload.campaign_id,
        'lead_id': payload.lead_id,
        'channel_id': result.get('id') or result.get('channelId'),
        'raw': result,
    }
