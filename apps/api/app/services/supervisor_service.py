import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import CallAttempt, Campaign, Lead
from app.schemas.supervisor import ManualCallRequest
from app.services.worker_client import enqueue_manual_call


def get_call_attempt(db: Session, attempt_id: int) -> CallAttempt | None:
    return db.get(CallAttempt, attempt_id)


def request_call_action(db: Session, attempt_id: int, action: str) -> dict | None:
    attempt = get_call_attempt(db, attempt_id)
    if attempt is None:
        return None

    return {
        'status': 'accepted',
        'implemented': False,
        'action': action,
        'call_attempt_id': attempt_id,
        'external_call_id': attempt.external_call_id,
    }


def launch_manual_call(db: Session, payload: ManualCallRequest) -> dict | None:
    campaign = db.get(Campaign, payload.campaign_id)
    if campaign is None:
        return None

    lead = Lead(
        tenant_id=campaign.tenant_id,
        campaign_id=campaign.id,
        full_name=payload.full_name,
        phone_number=payload.phone_number,
        timezone=payload.timezone,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)

    caller_id = payload.caller_id or campaign.caller_id
    enqueue_manual_call(campaign.id, lead.id, caller_id)

    return {
        'status': 'queued',
        'campaign_id': campaign.id,
        'campaign_name': campaign.name,
        'lead_id': lead.id,
        'full_name': lead.full_name,
        'phone_number': lead.phone_number,
        'caller_id': caller_id,
        'queued_task': 'worker.tasks.enqueue_campaign.originate_call',
    }


def list_recent_calls(db: Session, limit: int = 12, tenant_id: int | None = None) -> list[dict]:
    statement = select(CallAttempt).order_by(CallAttempt.created_at.desc()).limit(limit)
    if tenant_id is not None:
        statement = statement.where(CallAttempt.tenant_id == tenant_id)

    attempts = list(db.scalars(statement).all())
    if not attempts:
        return []

    campaign_ids = sorted({attempt.campaign_id for attempt in attempts})
    lead_ids = sorted({attempt.lead_id for attempt in attempts})
    campaigns = {
        campaign.id: campaign
        for campaign in db.scalars(select(Campaign).where(Campaign.id.in_(campaign_ids))).all()
    }
    leads = {
        lead.id: lead
        for lead in db.scalars(select(Lead).where(Lead.id.in_(lead_ids))).all()
    }

    return [
        {
            'id': attempt.id,
            'campaign_id': attempt.campaign_id,
            'campaign_name': campaigns.get(attempt.campaign_id).name if campaigns.get(attempt.campaign_id) else 'Unknown campaign',
            'lead_id': attempt.lead_id,
            'lead_name': leads.get(attempt.lead_id).full_name if leads.get(attempt.lead_id) else 'Unknown lead',
            'phone_number': leads.get(attempt.lead_id).phone_number if leads.get(attempt.lead_id) else 'N/A',
            'status': attempt.status,
            'external_call_id': attempt.external_call_id,
            'hangup_cause': attempt.hangup_cause,
            'started_at': attempt.started_at,
            'answered_at': attempt.answered_at,
            'ended_at': attempt.ended_at,
            'created_at': attempt.created_at,
        }
        for attempt in attempts
    ]


def get_telephony_status() -> dict:
    controller_url = settings.ARI_CONTROLLER_URL.rstrip('/')
    health_url = f'{controller_url}/health'

    try:
        response = requests.get(health_url, timeout=3)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        message = f'ARI controller unreachable: {exc}'
        return {
            'status': 'offline',
            'service': 'ari-controller',
            'message': message,
            'ari_controller_url': controller_url,
            'websocket': None,
        }
    except ValueError:
        return {
            'status': 'degraded',
            'service': 'ari-controller',
            'message': 'ARI controller returned an invalid health payload.',
            'ari_controller_url': controller_url,
            'websocket': None,
        }

    websocket = payload.get('websocket') if isinstance(payload, dict) else None
    websocket_state = str((websocket or {}).get('state') or 'unknown')
    websocket_error = (websocket or {}).get('last_error')
    websocket_close_message = (websocket or {}).get('last_close_message')

    if websocket_state == 'connected':
        status = 'ok'
        message = 'ARI websocket is connected to the external Asterisk server.'
    elif websocket_state in {'connecting', 'reconnecting'}:
        status = 'degraded'
        message = websocket_error or websocket_close_message or 'ARI websocket is reconnecting.'
    else:
        status = 'degraded'
        message = websocket_error or websocket_close_message or 'ARI websocket is not connected.'

    if message and status != 'ok' and not message.startswith('ARI websocket'):
        message = f'ARI websocket error: {message}'

    return {
        'status': status,
        'service': 'ari-controller',
        'message': message,
        'ari_controller_url': controller_url,
        'websocket': websocket,
    }
