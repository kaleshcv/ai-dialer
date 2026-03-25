from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.campaigns import CampaignOut
from app.schemas.supervisor import ManualCallRequest, ManualCallResponse, RecentCallOut, TelephonyStatusOut
from app.services.campaign_service import pause_campaign, resume_campaign
from app.services.supervisor_service import (
    get_telephony_status,
    launch_manual_call,
    list_recent_calls,
    request_call_action,
)
from app.services.worker_client import enqueue_campaign_start

router = APIRouter(prefix='/api/v1/supervisor', tags=['supervisor'])


@router.post('/campaign/{campaign_id}/pause', response_model=CampaignOut)
def pause_campaign_route(campaign_id: int, db: Session = Depends(get_db)):
    campaign = pause_campaign(db, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail='Campaign not found')
    return campaign


@router.post('/campaign/{campaign_id}/resume', response_model=CampaignOut)
def resume_campaign_route(campaign_id: int, db: Session = Depends(get_db)):
    campaign = resume_campaign(db, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail='Campaign not found')
    enqueue_campaign_start(campaign_id)
    return campaign


@router.get('/calls', response_model=list[RecentCallOut])
def get_recent_calls(limit: int = 12, tenant_id: int | None = None, db: Session = Depends(get_db)):
    return list_recent_calls(db, limit=limit, tenant_id=tenant_id)


@router.get('/telephony-status', response_model=TelephonyStatusOut)
def telephony_status_route():
    return get_telephony_status()


@router.post('/manual-call', response_model=ManualCallResponse, status_code=202)
def manual_call_route(payload: ManualCallRequest, db: Session = Depends(get_db)):
    response = launch_manual_call(db, payload)
    if response is None:
        raise HTTPException(status_code=404, detail='Campaign not found')
    return response


@router.post('/call/{attempt_id}/barge')
def barge_call(attempt_id: int, db: Session = Depends(get_db)):
    response = request_call_action(db, attempt_id, 'barge')
    if response is None:
        raise HTTPException(status_code=404, detail='Call attempt not found')
    return response


@router.post('/call/{attempt_id}/whisper')
def whisper_call(attempt_id: int, db: Session = Depends(get_db)):
    response = request_call_action(db, attempt_id, 'whisper')
    if response is None:
        raise HTTPException(status_code=404, detail='Call attempt not found')
    return response
