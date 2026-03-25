from pydantic import BaseModel, Field


class MetricsSnapshotOut(BaseModel):
    timestamp: str
    active_calls: int = Field(ge=0)
    agents_ready: int = Field(ge=0)
    queue: int = Field(ge=0)
    answer_rate: float = Field(ge=0.0, le=1.0)
    abandon_rate: float = Field(ge=0.0, le=1.0)
    campaigns_live: int = Field(ge=0)
