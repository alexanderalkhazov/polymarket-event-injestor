FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

COPY src/event_detectors/sec_producer/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY src/event_detectors/sec_producer/ /app/sec_producer/

CMD ["python", "-m", "sec_producer"]
