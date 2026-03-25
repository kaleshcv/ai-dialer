from datetime import datetime

from pydantic import BaseModel, Field


class ManualCallRequest(BaseModel):
    campaign_id: int = Field(ge=1)
    full_name: str = Field(min_length=1, max_length=255)
    phone_number: str = Field(min_length=6, max_length=32)
    timezone: str = Field(default='Asia/Kolkata', max_length=64)
    caller_id: str | None = Field(default=None, min_length=1, max_length=64)


class ManualCallResponse(BaseModel):
    status: str
    campaign_id: int
    campaign_name: str
    lead_id: int
    full_name: str
    phone_number: str
    caller_id: str
    queued_task: str


class RecentCallOut(BaseModel):
    id: int
    campaign_id: int
    campaign_name: str
    lead_id: int
    lead_name: str
    phone_number: str
    status: str
    external_call_id: str | None
    hangup_cause: str | None
    started_at: datetime | None
    answered_at: datetime | None
    ended_at: datetime | None
    created_at: datetime


class TelephonyWebsocketStatusOut(BaseModel):
    state: str
    ws_url: str | None = None
    last_error: str | None = None
    last_error_at: str | None = None
    last_close_code: int | None = None
    last_close_message: str | None = None
    last_close_at: str | None = None
    last_connected_at: str | None = None
    last_event_at: str | None = None


class TelephonyStatusOut(BaseModel):
    status: str
    service: str
    message: str | None = None
    ari_controller_url: str
    websocket: TelephonyWebsocketStatusOut | None = None
