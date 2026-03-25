from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

DialingMode = Literal['preview', 'progressive', 'power', 'predictive']
CampaignStatus = Literal['draft', 'active', 'paused', 'completed']


class CampaignCreate(BaseModel):
    tenant_id: int = Field(default=1, ge=1)
    name: str = Field(min_length=1, max_length=255)
    dialing_mode: DialingMode
    max_concurrent_lines: int = Field(default=10, ge=1, le=500)
    retry_attempts: int = Field(default=3, ge=0, le=20)
    caller_id: str = Field(default='1000', min_length=1, max_length=64)


class CampaignOut(BaseModel):
    id: int
    tenant_id: int
    name: str
    dialing_mode: DialingMode
    status: CampaignStatus
    is_active: bool
    max_concurrent_lines: int
    retry_attempts: int
    caller_id: str
    paused_at: datetime | None
    created_at: datetime

    model_config = {'from_attributes': True}
