from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.routes_auth import router as auth_router
from app.api.v1.routes_accent_ai import router as accent_ai_router
from app.api.v1.routes_campaigns import router as campaigns_router
from app.api.v1.routes_leads import router as leads_router
from app.api.v1.routes_metrics import router as metrics_router
from app.core.config import settings

app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION)
localhost_origin_regex = r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$' if settings.ENV != 'prod' else None

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.api_cors_origins,
    allow_origin_regex=localhost_origin_regex,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(auth_router)
app.include_router(accent_ai_router)
app.include_router(campaigns_router)
app.include_router(leads_router)
app.include_router(metrics_router)


@app.get('/health')
def health() -> dict[str, str]:
    return {
        'status': 'ok',
        'environment': settings.ENV,
        'service': settings.APP_NAME,
    }
