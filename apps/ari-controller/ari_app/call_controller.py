import uuid

from ari_app.client import ari_post
from ari_app.config import settings


PHONE_TOKENS = ('{phone_number}', '{phone}')


def _apply_phone_template(template: str, phone_number: str) -> str:
    for token in PHONE_TOKENS:
        if token in template:
            return template.replace(token, phone_number)
    return template


def build_dial_endpoint(phone_number: str) -> str:
    trunk_endpoint = settings.SIP_TRUNK_ENDPOINT.strip()

    if not trunk_endpoint:
        raise ValueError('SIP_TRUNK_ENDPOINT must not be empty.')

    if any(token in trunk_endpoint for token in PHONE_TOKENS):
        return _apply_phone_template(trunk_endpoint, phone_number)

    if not trunk_endpoint.startswith('PJSIP/'):
        return f'{trunk_endpoint}/{phone_number}'

    destination = trunk_endpoint.removeprefix('PJSIP/')

    if '/' not in destination:
        return f'PJSIP/{phone_number}@{destination}'

    endpoint_name, request_uri = destination.split('/', 1)
    resolved_request_uri = _apply_phone_template(request_uri, phone_number)

    if resolved_request_uri == request_uri:
        if request_uri.startswith(('sip:', 'sips:')):
            scheme, _, target = request_uri.partition(':')
            target = target.lstrip('/')
            if '@' in target:
                user_part, _, host_part = target.partition('@')
                if user_part:
                    return trunk_endpoint
                resolved_request_uri = f'{scheme}:{phone_number}@{host_part}'
            else:
                resolved_request_uri = f'{scheme}:{phone_number}@{target}'
        else:
            resolved_request_uri = f'sip:{phone_number}@{request_uri.lstrip("/")}'

    return f'PJSIP/{endpoint_name}/{resolved_request_uri}'


def originate_customer_call(phone_number: str, metadata: dict) -> dict:
    channel_id = str(uuid.uuid4())
    endpoint = build_dial_endpoint(phone_number)
    app_args = f"campaign_id={metadata['campaign_id']},lead_id={metadata['lead_id']}"
    return ari_post(
        '/channels',
        params={
            'endpoint': endpoint,
            'app': settings.ARI_APP_NAME,
            'appArgs': app_args,
            'channelId': channel_id,
            'callerId': metadata.get('caller_id', '1000'),
        },
        json_body={
            'variables': {
                'CAMPAIGN_ID': str(metadata['campaign_id']),
                'LEAD_ID': str(metadata['lead_id']),
            }
        },
    )
