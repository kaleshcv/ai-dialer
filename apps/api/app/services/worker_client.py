from celery import Celery
from app.core.config import settings

celery_client = Celery('dialer_api_client', broker=settings.REDIS_URL, backend=settings.REDIS_URL)
celery_client.conf.task_default_queue = 'dialer'


def enqueue_campaign_start(campaign_id: int) -> None:
    celery_client.send_task('worker.tasks.enqueue_campaign.enqueue_campaign_tick', args=[campaign_id])


def enqueue_manual_call(campaign_id: int, lead_id: int, caller_id: str | None = None) -> None:
    celery_client.send_task(
        'worker.tasks.enqueue_campaign.originate_call',
        args=[campaign_id, lead_id, caller_id],
    )
