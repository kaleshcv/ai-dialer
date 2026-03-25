from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    ARI_BASE_URL: str
    ARI_WS_URL: str
    ARI_USERNAME: str
    ARI_PASSWORD: str
    ARI_APP_NAME: str = 'dialer-app'
    SIP_TRUNK_ENDPOINT: str = 'PJSIP/mytrunk-endpoint'
    ARI_EVENT_RECONNECT_SECONDS: int = 5
    VERBOSE_DOCKER_LOGS: bool = False


settings = Settings()
