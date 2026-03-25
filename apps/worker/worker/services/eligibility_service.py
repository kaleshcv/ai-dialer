from datetime import datetime
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from worker.models import Lead


def fetch_eligible_leads(db: Session, campaign_id: int, limit: int) -> list[Lead]:
    if limit <= 0:
        return []

    stmt = (
        select(Lead)
        .where(Lead.campaign_id == campaign_id)
        .where(Lead.status.in_(['new', 'retry']))
        .where(or_(Lead.next_retry_at.is_(None), Lead.next_retry_at <= datetime.utcnow()))
        .order_by(Lead.id.asc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())
