import asyncio, logging, os
from .producer import CrossAssetProducer

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s | %(levelname)s | cross-asset | %(message)s",
)

if __name__ == "__main__":
    asyncio.run(CrossAssetProducer().run())
