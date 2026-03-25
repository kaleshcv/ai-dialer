from datetime import datetime, timedelta
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models import Agent, CallAttempt, Campaign, Lead

ACTIVE_CALL_STATUSES = ('dialing', 'originated', 'ringing', 'in_progress', 'bridged')
QUEUE_STATUSES = ('new', 'retry', 'retry_pending')


def get_metrics_snapshot(db: Session, tenant_id: int | None = None) -> dict:
    active_calls_query = select(func.count()).select_from(CallAttempt).where(CallAttempt.status.in_(ACTIVE_CALL_STATUSES))
    agents_ready_query = select(func.count()).select_from(Agent).where(Agent.status == 'ready')
    queue_query = select(func.count()).select_from(Lead).where(Lead.status.in_(QUEUE_STATUSES))
    live_campaigns_query = select(func.count()).select_from(Campaign).where(Campaign.is_active.is_(True))

    if tenant_id is not None:
        active_calls_query = active_calls_query.where(CallAttempt.tenant_id == tenant_id)
        agents_ready_query = agents_ready_query.where(Agent.tenant_id == tenant_id)
        queue_query = queue_query.where(Lead.tenant_id == tenant_id)
        live_campaigns_query = live_campaigns_query.where(Campaign.tenant_id == tenant_id)

    window_start = datetime.utcnow() - timedelta(minutes=settings.METRICS_WINDOW_MINUTES)
    recent_attempts_statement = (
        select(CallAttempt.answered_at, CallAttempt.status)
        .where(CallAttempt.created_at >= window_start)
        .order_by(CallAttempt.created_at.desc())
        .limit(200)
    )
    if tenant_id is not None:
        recent_attempts_statement = recent_attempts_statement.where(CallAttempt.tenant_id == tenant_id)

    recent_attempts = list(db.execute(recent_attempts_statement).all())
    total_recent = len(recent_attempts)
    answered_recent = sum(
        1 for answered_at, status in recent_attempts if answered_at is not None or status in {'answered', 'completed'}
    )
    abandoned_recent = sum(1 for _, status in recent_attempts if status == 'abandoned')

    answer_rate = round(answered_recent / total_recent, 3) if total_recent else 0.0
    abandon_rate = round(abandoned_recent / answered_recent, 3) if answered_recent else 0.0

    return {
        'timestamp': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        'active_calls': db.scalar(active_calls_query) or 0,
        'agents_ready': db.scalar(agents_ready_query) or 0,
        'queue': db.scalar(queue_query) or 0,
        'answer_rate': answer_rate,
        'abandon_rate': abandon_rate,
        'campaigns_live': db.scalar(live_campaigns_query) or 0,
    }
