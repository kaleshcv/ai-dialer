import requests
from worker.config import settings


def request_outbound_call(campaign_id: int, lead_id: int, phone_number: str, caller_id: str) -> dict:
    resp = requests.post(
        f'{settings.ARI_CONTROLLER_URL}/originate',
        json={
            'campaign_id': campaign_id,
            'lead_id': lead_id,
            'phone_number': phone_number,
            'caller_id': caller_id,
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()
