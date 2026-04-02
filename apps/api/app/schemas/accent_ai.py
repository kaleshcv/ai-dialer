from pydantic import BaseModel, Field


class AccentAiInfoOut(BaseModel):
    status: str = 'ok'
    backend: str = 'accentai-dsp'
    ready: bool
    model_root: str
    available_languages: list[str] = []
    pipeline: str = 'control_only_converted_mic_source'
    control_mode: str = 'device-control'
    service_enabled: bool = True
    host_pipeline_enabled: bool = False
    host_pipeline_running: bool = False
    host_audio_ready: bool = False
    asr_model: str | None = None
    tts_model: str | None = None
    tts_sample_rate: int | None = None
    required_files: dict[str, str] = {}


class AccentAiResetRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)


class AccentAiResetResponse(BaseModel):
    status: str = 'ok'
    session_id: str


class AccentAiHostControlResponse(BaseModel):
    status: str = 'ok'
    running: bool
