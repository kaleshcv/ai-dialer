from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import Campaign
from app.schemas.campaigns import CampaignCreate


def create_campaign(db: Session, payload: CampaignCreate) -> Campaign:
    campaign = Campaign(
        tenant_id=payload.tenant_id,
        name=payload.name,
        dialing_mode=payload.dialing_mode,
        max_concurrent_lines=payload.max_concurrent_lines,
        retry_attempts=payload.retry_attempts,
        caller_id=payload.caller_id,
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def get_campaign(db: Session, campaign_id: int) -> Campaign | None:
    return db.get(Campaign, campaign_id)


def start_campaign(db: Session, campaign_id: int) -> Campaign | None:
    campaign = get_campaign(db, campaign_id)
    if not campaign:
        return None
    campaign.status = 'active'
    campaign.is_active = True
    campaign.paused_at = None
    db.commit()
    db.refresh(campaign)
    return campaign


def pause_campaign(db: Session, campaign_id: int) -> Campaign | None:
    campaign = get_campaign(db, campaign_id)
    if not campaign:
        return None
    campaign.status = 'paused'
    campaign.is_active = False
    campaign.paused_at = datetime.utcnow()
    db.commit()
    db.refresh(campaign)
    return campaign


def resume_campaign(db: Session, campaign_id: int) -> Campaign | None:
    return start_campaign(db, campaign_id)


def list_campaigns(db: Session, tenant_id: int | None = None) -> list[Campaign]:
    statement = select(Campaign)
    if tenant_id is not None:
        statement = statement.where(Campaign.tenant_id == tenant_id)
    statement = statement.order_by(Campaign.id.desc())
    return list(db.scalars(statement).all())
