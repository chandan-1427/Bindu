"""Minimal tests for bindufy module."""

from unittest.mock import Mock
import pytest
from uuid import UUID

from bindu.penguin.bindufy import (
    _generate_agent_id,
    _normalize_execution_costs,
    _setup_x402_extension,
    _parse_deployment_url,
)


class TestBindufyUtilities:
    """Test bindufy utility functions."""

    def test_generate_agent_id_deterministic(self):
        """Test that agent ID generation is deterministic."""
        config1 = {"author": "test@example.com", "name": "TestAgent"}
        config2 = {"author": "test@example.com", "name": "TestAgent"}

        id1 = _generate_agent_id(config1)
        id2 = _generate_agent_id(config2)

        assert isinstance(id1, UUID)
        assert id1 == id2

    def test_generate_agent_id_different_for_different_inputs(self):
        """Test that different inputs produce different IDs."""
        config1 = {"author": "test@example.com", "name": "Agent1"}
        config2 = {"author": "test@example.com", "name": "Agent2"}

        id1 = _generate_agent_id(config1)
        id2 = _generate_agent_id(config2)

        assert id1 != id2

    def test_normalize_execution_costs_single_dict(self):
        """Test normalizing single dict to list."""
        cost = {"amount": "100", "token": "USDC", "network": "base"}

        result = _normalize_execution_costs(cost)

        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["amount"] == "100"

    def test_normalize_execution_costs_list(self):
        """Test normalizing list of dicts."""
        costs = [
            {"amount": "100", "token": "USDC", "network": "base"},
            {"amount": "200", "token": "ETH", "network": "ethereum"},
        ]

        result = _normalize_execution_costs(costs)

        assert isinstance(result, list)
        assert len(result) == 2

    def test_normalize_execution_costs_empty_list_raises(self):
        """Test that empty list raises ValueError."""
        with pytest.raises(ValueError, match="cannot be empty"):
            _normalize_execution_costs([])

    def test_normalize_execution_costs_invalid_type_raises(self):
        """Test that invalid type raises ValueError."""
        with pytest.raises(ValueError, match="must be either a dict or a list"):
            _normalize_execution_costs("invalid")

    def test_setup_x402_extension(self):
        """Test creating X402 extension from costs."""
        costs = [
            {
                "amount": "100",
                "token": "USDC",
                "network": "base-sepolia",
                "pay_to_address": "0x123",
            }
        ]

        extension = _setup_x402_extension(costs)

        assert extension is not None
        assert extension.amount == "100"
        assert extension.token == "USDC"

    def test_parse_deployment_url_with_port(self):
        """Test parsing deployment URL with port."""
        mock_config = Mock()
        mock_config.url = "http://localhost:8080"

        host, port = _parse_deployment_url(mock_config)

        assert host == "localhost"
        assert port == 8080

    def test_parse_deployment_url_without_port(self):
        """Test parsing deployment URL without port uses default."""
        mock_config = Mock()
        mock_config.url = "http://localhost"

        host, port = _parse_deployment_url(mock_config)

        assert host == "localhost"
        assert port == 3773

    def test_parse_deployment_url_none_returns_defaults(self):
        """Test that None config returns default values."""
        host, port = _parse_deployment_url(None)

        assert host == "localhost"
        assert port == 3773
