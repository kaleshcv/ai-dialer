import asyncio
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.schemas.metrics import MetricsSnapshotOut
from app.services.metrics_service import get_metrics_snapshot

router = APIRouter(tags=['metrics'])


@router.get('/metrics', response_model=MetricsSnapshotOut)
@router.get('/api/v1/metrics', response_model=MetricsSnapshotOut, include_in_schema=False)
def http_metrics(tenant_id: int | None = None, db: Session = Depends(get_db)):
    return get_metrics_snapshot(db, tenant_id=tenant_id)


@router.websocket('/ws/metrics')
@router.websocket('/api/v1/ws/metrics')
async def ws_metrics(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            with SessionLocal() as db:
                snapshot = get_metrics_snapshot(db)
            await websocket.send_json(snapshot)
            await asyncio.sleep(settings.METRICS_STREAM_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        return
