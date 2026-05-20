import asyncio, logging, os
from .producer import ShortSqueezeProducer

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s | %(levelname)s | short-squeeze | %(message)s",
)

if __name__ == "__main__":
    asyncio.run(ShortSqueezeProducer().run())
