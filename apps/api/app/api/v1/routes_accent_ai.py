from fastapi import APIRouter, WebSocket

from app.schemas.accent_ai import (
    AccentAiAudioDefaultsRequest,
    AccentAiAudioDefaultsResponse,
    AccentAiHostControlResponse,
    AccentAiInfoOut,
    AccentAiResetRequest,
    AccentAiResetResponse,
)
from app.services.accent_ai_service import (
    get_accent_ai_info,
    handle_accent_ai_websocket,
    reset_accent_ai_session,
    set_accent_ai_audio_defaults,
    start_accent_ai_host_pipeline,
    stop_accent_ai_host_pipeline,
)

router = APIRouter(prefix='/api/v1/accent-ai', tags=['accent-ai'])


@router.get('/info', response_model=AccentAiInfoOut)
def accent_ai_info():
    return get_accent_ai_info()


@router.post('/reset', response_model=AccentAiResetResponse)
def accent_ai_reset(payload: AccentAiResetRequest):
    return reset_accent_ai_session(payload.session_id)


@router.post('/start', response_model=AccentAiHostControlResponse)
def accent_ai_start():
    return start_accent_ai_host_pipeline()


@router.post('/stop', response_model=AccentAiHostControlResponse)
def accent_ai_stop():
    return stop_accent_ai_host_pipeline()


@router.post('/audio-defaults', response_model=AccentAiAudioDefaultsResponse)
def accent_ai_audio_defaults(payload: AccentAiAudioDefaultsRequest):
    return set_accent_ai_audio_defaults(input_label=payload.input_label, output_label=payload.output_label)


@router.websocket('/ws')
async def accent_ai_ws(websocket: WebSocket):
    await handle_accent_ai_websocket(websocket)
