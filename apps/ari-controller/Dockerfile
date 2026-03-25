FROM python:3.12-slim
ARG APP_UID=1000
ARG APP_GID=1000
WORKDIR /app
RUN groupadd --gid ${APP_GID} appgroup \
    && useradd --uid ${APP_UID} --gid ${APP_GID} --create-home --shell /bin/sh appuser
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY . /app
