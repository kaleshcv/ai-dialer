import os
import socket

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


SUPPORTED_DATABASE_MODES = {'auto', 'host', 'docker', 'direct'}


def _running_in_docker() -> bool:
    return os.path.exists('/.dockerenv')


def _default_host_postgres_host() -> str:
    return 'host.docker.internal' if _running_in_docker() else '127.0.0.1'


def _is_tcp_reachable(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _build_database_url(
    driver: str,
    username: str,
    password: str,
    host: str,
    port: int,
    database: str,
) -> str:
    return URL.create(
        drivername=driver,
        username=username,
        password=password,
        host=host,
        port=port,
        database=database,
    ).render_as_string(hide_password=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    APP_NAME: str = 'Dialer Combined API'
    APP_VERSION: str = '1.0.0'
    ENV: str = 'dev'
    DATABASE_MODE: str | None = None
    DATABASE_URL: str | None = None
    POSTGRES_DRIVER: str = 'postgresql+psycopg2'
    POSTGRES_DB: str = 'dialer'
    POSTGRES_USER: str = 'dialer'
    POSTGRES_PASSWORD: str = 'dialer'
    HOST_POSTGRES_HOST: str | None = None
    HOST_POSTGRES_PORT: int = 5432
    DOCKER_POSTGRES_HOST: str = 'postgres'
    DOCKER_POSTGRES_PORT: int = 5432
    JWT_SECRET: str = 'change-me'
    JWT_ALG: str = 'HS256'
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    API_HOST: str = '0.0.0.0'
    API_PORT: int = 8000
    API_CORS_ORIGINS: str = 'http://localhost:3000,http://127.0.0.1:3000'
    ALLOW_BOOTSTRAP: bool = True
    METRICS_WINDOW_MINUTES: int = 60
    METRICS_STREAM_INTERVAL_SECONDS: int = 2

    @field_validator('DATABASE_MODE', mode='before')
    @classmethod
    def _normalize_database_mode(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        return normalized or None

    @field_validator('DATABASE_URL', 'HOST_POSTGRES_HOST', mode='before')
    @classmethod
    def _empty_strings_to_none(cls, value: str | None) -> str | None:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode='after')
    def _resolve_database_url(self) -> 'Settings':
        database_mode = self.DATABASE_MODE or ('direct' if self.DATABASE_URL else 'auto')
        if database_mode not in SUPPORTED_DATABASE_MODES:
            supported_modes = ', '.join(sorted(SUPPORTED_DATABASE_MODES))
            raise ValueError(f'DATABASE_MODE must be one of: {supported_modes}')

        self.DATABASE_MODE = database_mode
        if database_mode == 'direct':
            if not self.DATABASE_URL:
                raise ValueError('DATABASE_URL is required when DATABASE_MODE=direct')
            return self

        host_postgres_host = self.HOST_POSTGRES_HOST or _default_host_postgres_host()
        host_database_url = _build_database_url(
            driver=self.POSTGRES_DRIVER,
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=host_postgres_host,
            port=self.HOST_POSTGRES_PORT,
            database=self.POSTGRES_DB,
        )
        docker_database_url = _build_database_url(
            driver=self.POSTGRES_DRIVER,
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.DOCKER_POSTGRES_HOST,
            port=self.DOCKER_POSTGRES_PORT,
            database=self.POSTGRES_DB,
        )

        if database_mode == 'host':
            self.DATABASE_URL = host_database_url
            return self
        if database_mode == 'docker':
            self.DATABASE_URL = docker_database_url
            return self

        if _is_tcp_reachable(host_postgres_host, self.HOST_POSTGRES_PORT):
            self.DATABASE_URL = host_database_url
        elif _is_tcp_reachable(self.DOCKER_POSTGRES_HOST, self.DOCKER_POSTGRES_PORT):
            self.DATABASE_URL = docker_database_url
        else:
            self.DATABASE_URL = host_database_url
        return self

    @property
    def api_cors_origins(self) -> list[str]:
        return [item.strip() for item in self.API_CORS_ORIGINS.split(',') if item.strip()]


settings = Settings()
