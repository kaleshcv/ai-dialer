from datetime import datetime, timedelta
from worker.celery_app import celery_app
from worker.config import settings
from worker.database import SessionLocal
from worker.models import CallAttempt, Campaign, Lead
from worker.services.ari_service import request_outbound_call
from worker.services.eligibility_service import fetch_eligible_leads
from worker.services.pacing_engine import compute_calls_to_launch


@celery_app.task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=5)
def enqueue_campaign_tick(self, campaign_id: int):
    with SessionLocal() as db:
        campaign = db.get(Campaign, campaign_id)
        if campaign is None:
            return {'status': 'missing-campaign', 'campaign_id': campaign_id}
        if not campaign.is_active or campaign.status != 'active':
            return {'status': 'inactive-campaign', 'campaign_id': campaign_id}

        launches = compute_calls_to_launch(db, campaign_id)
        leads = fetch_eligible_leads(db, campaign_id, limit=launches)
        for lead in leads:
            originate_call.delay(campaign_id, lead.id)
        return {'campaign_id': campaign_id, 'launches_requested': launches, 'leads_selected': len(leads)}


@celery_app.task(bind=True)
def originate_call(self, campaign_id: int, lead_id: int, caller_id: str | None = None):
    with SessionLocal() as db:
        campaign = db.get(Campaign, campaign_id)
        lead = db.get(Lead, lead_id)
        if not campaign:
            return {'status': 'missing-campaign', 'campaign_id': campaign_id}
        if not lead:
            return {'status': 'missing-lead', 'lead_id': lead_id}

        now = datetime.utcnow()
        attempt = CallAttempt(
            tenant_id=lead.tenant_id,
            campaign_id=campaign_id,
            lead_id=lead_id,
            status='dialing',
            started_at=now,
            created_at=now,
        )
        db.add(attempt)
        lead.status = 'dialing'
        lead.attempt_count += 1
        lead.last_attempt_at = now
        lead.next_retry_at = None
        db.commit()
        db.refresh(attempt)

        try:
            response = request_outbound_call(
                campaign_id=campaign_id,
                lead_id=lead_id,
                phone_number=lead.phone_number,
                caller_id=caller_id or campaign.caller_id,
            )
            channel_id = response.get('channel_id')
            if not channel_id:
                raise RuntimeError('ARI controller returned no channel_id')

            attempt.external_call_id = channel_id
            attempt.status = 'originated'
            db.commit()
            return {'attempt_id': attempt.id, 'channel_id': attempt.external_call_id, 'status': 'originated'}
        except Exception as exc:
            attempt.status = 'failed'
            error_message = str(exc).strip()
            hangup_cause = exc.__class__.__name__
            if error_message and error_message != hangup_cause:
                hangup_cause = f'{hangup_cause}: {error_message}'
            attempt.hangup_cause = hangup_cause[:128]
            attempt.ended_at = datetime.utcnow()

            if lead.attempt_count <= campaign.retry_attempts:
                lead.status = 'retry_pending'
                lead.next_retry_at = datetime.utcnow() + timedelta(seconds=settings.RETRY_DELAY_SECONDS)
            else:
                lead.status = 'failed'
                lead.next_retry_at = None

            db.commit()
            return {
                'attempt_id': attempt.id,
                'status': 'failed',
                'hangup_cause': attempt.hangup_cause,
            }
