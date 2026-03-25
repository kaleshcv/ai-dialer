from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import Campaign, Lead
from app.schemas.leads import LeadImportRequest


def import_leads(db: Session, payload: LeadImportRequest) -> list[Lead]:
    campaign = db.get(Campaign, payload.campaign_id)
    if campaign is None:
        raise LookupError('Campaign not found')

    leads = [
        Lead(
            tenant_id=campaign.tenant_id,
            campaign_id=payload.campaign_id,
            full_name=item.full_name,
            phone_number=item.phone_number,
            timezone=item.timezone,
        )
        for item in payload.leads
    ]
    db.add_all(leads)
    db.commit()
    for lead in leads:
        db.refresh(lead)
    return leads


def list_leads(db: Session, campaign_id: int | None = None, tenant_id: int | None = None) -> list[Lead]:
    statement = select(Lead)
    if campaign_id is not None:
        statement = statement.where(Lead.campaign_id == campaign_id)
    if tenant_id is not None:
        statement = statement.where(Lead.tenant_id == tenant_id)
    statement = statement.order_by(Lead.id.desc())
    return list(db.scalars(statement).all())
