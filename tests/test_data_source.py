"""Tests for PolymarketClient and Gamma API parsing."""

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from polymarket_kafka.config import PolymarketConfig
from polymarket_kafka.data_source import (
    MarketSnapshot,
    PolymarketApiError,
    PolymarketClient,
)


@pytest.fixture
def config():
    return PolymarketConfig(
        base_url="https://gamma-api.polymarket.com",
        request_timeout_seconds=30,
        rate_limit_delay_ms=0,
    )


@pytest.fixture
def client(config):
    return PolymarketClient(config)


# Sample Gamma API market objects
GAMMA_BINARY_MARKET = {
    "id": "12",
    "question": "Will Joe Biden get Coronavirus before the election?",
    "conditionId": "0xe3b423dfad8c22ff75c9899c4e8176f628cf4ad4caa00481764d320e7415f7a9",
    "outcomes": '["Yes", "No"]',
    "outcomePrices": '["0.72", "0.28"]',
    "volume": "32257.445115",
    "liquidity": "0",
    "volumeNum": 32257.45,
    "liquidityNum": 0.0,
    "active": True,
    "closed": False,
}


GAMMA_SCALAR_MARKET = {
    "id": "43",
    "question": "What will the TVL in DeFi be?",
    "conditionId": "0x7333b6e016f7f60d86f15f11ed0b41b69deec0b6d73b86933639b1f39a545d87",
    "outcomes": '["Long", "Short"]',
    "outcomePrices": '["0.58", "0.42"]',
    "volumeNum": 46944.58,
    "liquidityNum": 4.6,
    "active": True,
    "closed": False,
}


class TestParseGammaMarket:
    """Test _parse_gamma_market parsing logic."""

    def test_parse_binary_market(self, client):
        snapshot = client._parse_gamma_market(GAMMA_BINARY_MARKET)
        assert snapshot is not None
        assert snapshot.market_id == "0xe3b423dfad8c22ff75c9899c4e8176f628cf4ad4caa00481764d320e7415f7a9"
        assert snapshot.question == "Will Joe Biden get Coronavirus before the election?"
        assert snapshot.yes_price == 0.72
        assert snapshot.no_price == 0.28
        assert snapshot.volume == 32257.45
        assert snapshot.liquidity == 0.0
        assert snapshot.active is True
        assert snapshot.closed is False
        assert isinstance(snapshot.fetched_at, datetime)

    def test_parse_scalar_market(self, client):
        snapshot = client._parse_gamma_market(GAMMA_SCALAR_MARKET)
        assert snapshot is not None
        assert snapshot.market_id == "0x7333b6e016f7f60d86f15f11ed0b41b69deec0b6d73b86933639b1f39a545d87"
        assert snapshot.yes_price == 0.58  # Long mapped to yes
        assert snapshot.no_price == 0.42   # Short mapped to no

    def test_parse_skips_missing_condition_id(self, client):
        data = {**GAMMA_BINARY_MARKET, "conditionId": ""}
        assert client._parse_gamma_market(data) is None

    def test_parse_skips_missing_outcomes(self, client):
        data = {**GAMMA_BINARY_MARKET, "outcomes": None}
        assert client._parse_gamma_market(data) is None

    def test_parse_raises_on_malformed_json(self, client):
        data = {**GAMMA_BINARY_MARKET, "outcomePrices": "not valid json"}
        with pytest.raises(PolymarketApiError, match="Failed to parse"):
            client._parse_gamma_market(data)

    def test_parse_skips_multicandidate_market(self, client):
        data = {
            **GAMMA_BINARY_MARKET,
            "outcomes": '["A", "B", "C"]',
            "outcomePrices": '["0.3", "0.4", "0.3"]',
        }
        assert client._parse_gamma_market(data) is None


class TestFetchAllMarkets:
    """Test fetch_all_markets."""

    def test_fetch_all_markets_returns_dict_keyed_by_condition_id(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [GAMMA_BINARY_MARKET, GAMMA_SCALAR_MARKET]

        with patch.object(client._session, "request", return_value=mock_response):
            result = client.fetch_all_markets()

        assert isinstance(result, dict)
        assert len(result) == 2
        assert "0xe3b423dfad8c22ff75c9899c4e8176f628cf4ad4caa00481764d320e7415f7a9" in result
        assert "0x7333b6e016f7f60d86f15f11ed0b41b69deec0b6d73b86933639b1f39a545d87" in result
        assert isinstance(result["0xe3b423dfad8c22ff75c9899c4e8176f628cf4ad4caa00481764d320e7415f7a9"], MarketSnapshot)

    def test_fetch_all_markets_raises_on_non_array_response(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"error": "not an array"}

        with patch.object(client._session, "request", return_value=mock_response):
            with pytest.raises(PolymarketApiError, match="Expected array"):
                client.fetch_all_markets()

    def test_fetch_all_markets_skips_unparseable_markets(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            GAMMA_BINARY_MARKET,
            {"conditionId": "bad", "outcomePrices": "invalid"},  # will fail parse
        ]

        with patch.object(client._session, "request", return_value=mock_response):
            result = client.fetch_all_markets()

        # Only the valid market should be included
        assert len(result) == 1
        assert "0xe3b423dfad8c22ff75c9899c4e8176f628cf4ad4caa00481764d320e7415f7a9" in result
