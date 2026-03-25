from pydantic import BaseModel, Field


class OriginateRequest(BaseModel):
    campaign_id: int
    lead_id: int
    phone_number: str = Field(min_length=6, max_length=32)
    caller_id: str = Field(default='1000', max_length=64)
