FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY src/data_init/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy all three source packages needed by the bootstrap script
COPY src/historical    /app/historical/
COPY src/feature_store /app/feature_store/
COPY src/ml            /app/ml_trainer/
COPY src/data_init/bootstrap.py /app/bootstrap.py

CMD ["python", "bootstrap.py"]
