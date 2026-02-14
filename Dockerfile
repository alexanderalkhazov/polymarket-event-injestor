FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./ 
COPY src ./src
COPY scripts ./scripts

RUN pip install --upgrade pip && \
    pip install . && \
    pip install debugpy

CMD ["python", "-m", "polymarket_kafka"]