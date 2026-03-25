from celery import Celery
from worker.config import settings

celery_app = Celery('dialer_worker', broker=settings.REDIS_URL, backend=settings.REDIS_URL)
celery_app.conf.update(
    task_default_queue='dialer',
    task_track_started=True,
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],
    timezone='UTC',
    broker_connection_retry_on_startup=True,
    beat_schedule={
        'dispatch-active-campaigns': {
            'task': 'worker.tasks.housekeeping.dispatch_active_campaigns',
            'schedule': 15.0,
        },
        'schedule-retries': {
            'task': 'worker.tasks.housekeeping.schedule_retries',
            'schedule': 60.0,
        },
        'process-callbacks': {
            'task': 'worker.tasks.housekeeping.process_callbacks',
            'schedule': 300.0,
        },
    },
    imports=(
        'worker.tasks.enqueue_campaign',
        'worker.tasks.housekeeping',
    ),
)
