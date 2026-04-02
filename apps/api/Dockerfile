FROM node:20-slim AS node_runtime

FROM python:3.12-slim
ARG APP_UID=1000
ARG APP_GID=1000
WORKDIR /app
COPY --from=node_runtime /usr/local /usr/local
RUN groupadd --gid ${APP_GID} appgroup \
    && useradd --uid ${APP_UID} --gid ${APP_GID} --create-home --shell /bin/sh appuser
COPY apps/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir "setuptools<81"
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY third_party /vendor
COPY apps/api /app
