from datetime import datetime
from pydantic import BaseModel, Field


class LeadCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    phone_number: str = Field(min_length=6, max_length=32)
    timezone: str = Field(default='Asia/Kolkata', max_length=64)


class LeadImportRequest(BaseModel):
    campaign_id: int
    leads: list[LeadCreate]


class LeadOut(BaseModel):
    id: int
    tenant_id: int
    campaign_id: int
    full_name: str
    phone_number: str
    timezone: str
    status: str
    attempt_count: int
    last_attempt_at: datetime | None
    next_retry_at: datetime | None
    created_at: datetime

    model_config = {'from_attributes': True}
