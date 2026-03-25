from datetime import datetime
from sqlalchemy import select
from worker.celery_app import celery_app
from worker.database import SessionLocal
from worker.models import Campaign, Lead
from worker.tasks.enqueue_campaign import enqueue_campaign_tick


@celery_app.task
def dispatch_active_campaigns():
    with SessionLocal() as db:
        campaign_ids = list(
            db.scalars(
                select(Campaign.id).where(Campaign.is_active.is_(True), Campaign.status == 'active')
            ).all()
        )

    for campaign_id in campaign_ids:
        enqueue_campaign_tick.delay(campaign_id)

    return {'campaigns_dispatched': len(campaign_ids), 'campaign_ids': campaign_ids}


@celery_app.task
def schedule_retries():
    now = datetime.utcnow()
    with SessionLocal() as db:
        leads = list(
            db.scalars(
                select(Lead)
                .where(Lead.status == 'retry_pending')
                .where(Lead.next_retry_at.is_not(None))
                .where(Lead.next_retry_at <= now)
            ).all()
        )
        for lead in leads:
            lead.status = 'retry'
            lead.next_retry_at = None
        db.commit()
    return {'leads_requeued': len(leads)}


@celery_app.task
def process_callbacks():
    return {'callbacks_processed': 0, 'status': 'noop'}
