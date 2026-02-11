#!/bin/bash
# Wait for Couchbase to be fully initialized, then create bucket + user
set -e

CB_HOST="${CB_HOST:-couchbase}"
CB_ADMIN_USER="${CB_ADMIN_USER:-Administrator}"
CB_ADMIN_PASS="${CB_ADMIN_PASS:-password}"
BUCKET_NAME="${BUCKET_NAME:-polymarket}"

echo "Waiting for Couchbase to start..."
until curl -sf http://${CB_HOST}:8091/pools > /dev/null 2>&1; do
    sleep 2
done
echo "Couchbase is up."

# Initialize cluster (ignore error if already initialized)
echo "Initializing cluster..."
curl -sf -X POST http://${CB_HOST}:8091/clusterInit \
    -d "hostname=${CB_HOST}" \
    -d "dataPath=/opt/couchbase/var/lib/couchbase/data" \
    -d "indexPath=/opt/couchbase/var/lib/couchbase/indexes" \
    -d "services=kv,index,n1ql" \
    -d "memoryQuota=256" \
    -d "indexMemoryQuota=256" \
    -d "username=${CB_ADMIN_USER}" \
    -d "password=${CB_ADMIN_PASS}" \
    -d "port=SAME" \
    2>/dev/null || echo "Cluster may already be initialized, continuing..."

sleep 3

# Create bucket
echo "Creating bucket '${BUCKET_NAME}'..."
curl -sf -X POST http://${CB_HOST}:8091/pools/default/buckets \
    -u "${CB_ADMIN_USER}:${CB_ADMIN_PASS}" \
    -d "name=${BUCKET_NAME}" \
    -d "ramQuota=128" \
    -d "bucketType=couchbase" \
    -d "flushEnabled=1" \
    2>/dev/null || echo "Bucket may already exist, continuing..."

sleep 2
echo "Couchbase setup complete: bucket '${BUCKET_NAME}' ready."
