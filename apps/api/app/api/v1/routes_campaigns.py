from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.campaigns import CampaignCreate, CampaignOut
from app.services.campaign_service import create_campaign, list_campaigns, pause_campaign, resume_campaign, start_campaign
from app.services.worker_client import enqueue_campaign_start

router = APIRouter(prefix='/api/v1/campaigns', tags=['campaigns'])


@router.get('', response_model=list[CampaignOut])
def get_campaigns(tenant_id: int | None = None, db: Session = Depends(get_db)):
    return list_campaigns(db, tenant_id=tenant_id)


@router.post('', response_model=CampaignOut, status_code=201)
def create_campaign_route(payload: CampaignCreate, db: Session = Depends(get_db)):
    return create_campaign(db, payload)


@router.post('/{campaign_id}/start', response_model=CampaignOut)
def start_campaign_route(campaign_id: int, db: Session = Depends(get_db)):
    campaign = start_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail='Campaign not found')
    enqueue_campaign_start(campaign_id)
    return campaign


@router.post('/{campaign_id}/pause', response_model=CampaignOut)
def pause_campaign_route(campaign_id: int, db: Session = Depends(get_db)):
    campaign = pause_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail='Campaign not found')
    return campaign


@router.post('/{campaign_id}/resume', response_model=CampaignOut)
def resume_campaign_route(campaign_id: int, db: Session = Depends(get_db)):
    campaign = resume_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail='Campaign not found')
    enqueue_campaign_start(campaign_id)
    return campaign
