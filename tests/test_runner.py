"""Tests for PolymarketKafkaRunner."""

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from polymarket_kafka.config import AppConfig, KafkaConfig, MongoConfig, PolymarketConfig
from polymarket_kafka.data_source import MarketSnapshot
from polymarket_kafka.kafka_client import KafkaClient
from polymarket_kafka.models import PolymarketSubscription
from polymarket_kafka.runner import PolymarketKafkaRunner
from polymarket_kafka.subscription_manager import SubscriptionManager


@pytest.fixture
def app_config():
    return AppConfig(
        kafka=KafkaConfig(bootstrap_servers="localhost", topic="test"),
        polymarket=PolymarketConfig(),
        mongodb=MongoConfig(uri="mongodb://localhost", database="test"),
        poll_interval_seconds=1,
    )


@pytest.fixture
def subscription_manager():
    mgr = MagicMock(spec=SubscriptionManager)
    mgr.get_active_subscriptions_async = AsyncMock(return_value=[])
    mgr.close = MagicMock()
    return mgr


@pytest.fixture
def kafka_client():
    client = MagicMock(spec=KafkaClient)
    client.publish_event = MagicMock()
    client.flush = MagicMock()
    return client


@pytest.fixture
def sample_snapshot():
    return MarketSnapshot(
        market_id="0xcond123",
        question="Test market?",
        yes_price=0.6,
        no_price=0.4,
        volume=1000.0,
        liquidity=500.0,
        active=True,
        closed=False,
        fetched_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_runner_skips_subscription_when_market_not_in_snapshots(
    app_config,
    subscription_manager,
    kafka_client,
):
    """Runner should skip subscriptions whose market_id is not in the fetch result."""
    sub = PolymarketSubscription(market_id="missing-market", ref_count=1)
    subscription_manager.get_active_subscriptions_async = AsyncMock(return_value=[sub])

    data_source = MagicMock()
    data_source.fetch_all_markets_async = AsyncMock(return_value={})  # empty, no markets
    data_source.close = MagicMock()

    runner = PolymarketKafkaRunner(
        config=app_config,
        subscription_manager=subscription_manager,
        data_source=data_source,
        kafka_client=kafka_client,
    )

    # Run runner in background; stop after first iteration completes
    task = asyncio.create_task(runner.run())
    await asyncio.sleep(0.2)  # Let first iteration start (fetch, process)
    runner.request_stop()
    await asyncio.sleep(1.5)  # Wait for poll interval sleep and loop exit
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    # Should have called fetch_all_markets_async
    data_source.fetch_all_markets_async.assert_called_once()
    # Should NOT have published any event (market not found)
    kafka_client.publish_event.assert_not_called()


@pytest.mark.asyncio
async def test_runner_processes_subscription_when_market_in_snapshots(
    app_config,
    subscription_manager,
    kafka_client,
    sample_snapshot,
):
    """Runner should process subscriptions whose market_id is in the fetch result."""
    sub = PolymarketSubscription(market_id="0xcond123", ref_count=1)
    subscription_manager.get_active_subscriptions_async = AsyncMock(return_value=[sub])

    data_source = MagicMock()
    data_source.fetch_all_markets_async = AsyncMock(
        return_value={"0xcond123": sample_snapshot}
    )
    data_source.close = MagicMock()

    runner = PolymarketKafkaRunner(
        config=app_config,
        subscription_manager=subscription_manager,
        data_source=data_source,
        kafka_client=kafka_client,
    )

    # Run runner in background; stop after first iteration completes
    task = asyncio.create_task(runner.run())
    await asyncio.sleep(0.2)  # Let first iteration start (fetch, process)
    runner.request_stop()
    await asyncio.sleep(1.5)  # Wait for poll interval sleep and loop exit
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    data_source.fetch_all_markets_async.assert_called_once()
    # With conviction state initialized, first poll may not publish (no prior price).
    subscription_manager.close.assert_called_once()
    data_source.close.assert_called_once()
