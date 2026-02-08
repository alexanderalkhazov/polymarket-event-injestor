FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./ 
COPY src ./src

RUN pip install --upgrade pip && \
    pip install .

ENV POLYMARKET_BASE_URL="https://gamma-api.polymarket.com" \
    KAFKA_BOOTSTRAP_SERVERS="kafka:9092" \
    KAFKA_TOPIC="polymarket-events" \
    KAFKA_SECURITY_PROTOCOL="PLAINTEXT" \
    KAFKA_CLIENT_ID="polymarket-kafka-producer" \
    MONGODB_URI="mongodb://mongo:27017" \
    MONGODB_DATABASE="horizon" \
    MONGODB_COLLECTION="polymarket_subscriptions" \
    MONGODB_POLL_INTERVAL_SECONDS=60 \
    POLYMARKET_RATE_LIMIT_DELAY_MS=200 \
    POLYMARKET_REQUEST_TIMEOUT_SECONDS=30 \
    POLL_INTERVAL_SECONDS=30 \
    ENVIRONMENT="dev"

CMD ["python", "-m", "polymarket_kafka"]

