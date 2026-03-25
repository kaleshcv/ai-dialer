import requests
from requests.auth import HTTPBasicAuth
from ari_app.config import settings


def _auth() -> HTTPBasicAuth:
    return HTTPBasicAuth(settings.ARI_USERNAME, settings.ARI_PASSWORD)


def ari_post(path: str, params: dict | None = None, json_body: dict | None = None):
    url = f'{settings.ARI_BASE_URL}{path}'
    response = requests.post(url, params=params or {}, json=json_body, auth=_auth(), timeout=10)
    response.raise_for_status()
    if response.text:
        try:
            return response.json()
        except ValueError:
            return {'raw': response.text}
    return {}
