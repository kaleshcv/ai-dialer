from sqlalchemy import func, select
from sqlalchemy.orm import Session
from worker.config import settings
from worker.models import Agent, CallAttempt, Campaign
from worker.predictive_engine import PredictiveEngine

ACTIVE_CALL_STATUSES = ('queued', 'dialing', 'originated', 'ringing', 'in_progress', 'bridged')

predictive_engine = PredictiveEngine(
    target_occupancy=settings.PREDICTIVE_TARGET_OCCUPANCY,
    min_answer_rate=settings.PREDICTIVE_MIN_ANSWER_RATE,
    max_abandon_rate=settings.PREDICTIVE_MAX_ABANDON_RATE,
)


def get_ready_agent_count(db: Session, tenant_id: int) -> int:
    statement = select(func.count()).select_from(Agent).where(Agent.tenant_id == tenant_id, Agent.status == 'ready')
    return db.scalar(statement) or 0


def get_recent_answer_rate(db: Session, campaign_id: int) -> float:
    rows = list(
        db.execute(
            select(CallAttempt.answered_at, CallAttempt.status)
            .where(CallAttempt.campaign_id == campaign_id)
            .order_by(CallAttempt.created_at.desc())
            .limit(200)
        ).all()
    )
    if not rows:
        return settings.PREDICTIVE_MIN_ANSWER_RATE

    answered = sum(1 for answered_at, status in rows if answered_at is not None or status in {'answered', 'completed'})
    return max(answered / len(rows), settings.PREDICTIVE_MIN_ANSWER_RATE)


def get_recent_abandon_rate(db: Session, campaign_id: int) -> float:
    rows = list(
        db.execute(
            select(CallAttempt.status)
            .where(CallAttempt.campaign_id == campaign_id)
            .order_by(CallAttempt.created_at.desc())
            .limit(200)
        ).scalars()
    )
    if not rows:
        return 0.0

    answered = sum(1 for status in rows if status in {'answered', 'completed', 'abandoned'})
    if answered == 0:
        return 0.0
    abandoned = sum(1 for status in rows if status == 'abandoned')
    return abandoned / answered


def get_inflight_outbound_calls(db: Session, campaign_id: int) -> int:
    statement = (
        select(func.count())
        .select_from(CallAttempt)
        .where(CallAttempt.campaign_id == campaign_id, CallAttempt.status.in_(ACTIVE_CALL_STATUSES))
    )
    return db.scalar(statement) or 0


def compute_calls_to_launch(db: Session, campaign_id: int) -> int:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None or not campaign.is_active or campaign.status != 'active':
        return 0

    active_agents = get_ready_agent_count(db, campaign.tenant_id)
    answer_rate = get_recent_answer_rate(db, campaign_id)
    abandon_rate = get_recent_abandon_rate(db, campaign_id)
    in_flight = get_inflight_outbound_calls(db, campaign_id)

    return predictive_engine.compute(
        ready_agents=active_agents,
        inflight=in_flight,
        answer_rate=answer_rate,
        abandon_rate=abandon_rate,
        line_limit=campaign.max_concurrent_lines,
    )
