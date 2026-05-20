import asyncio, logging, os
from .producer import GammaProducer

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s | %(levelname)s | gamma-producer | %(message)s",
)

if __name__ == "__main__":
    asyncio.run(GammaProducer().run())
