"""Tests for the operator-extensible EVM network registry.

`X402Settings.extra_networks` lets operators reach EVM chains beyond Base
mainnet/sepolia (which is all the x402 v2 SDK ships with). This module
covers the schema contract directly and the price-parser path that the
resource server uses to build PaymentRequirements for the extra chain.
"""

from __future__ import annotations

import pytest
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.schemas.base import AssetAmount

from bindu.settings import ExtraNetwork


class TestExtraNetworkValidation:
    """The model is the operator-facing surface. Validation errors should
    fire at settings-load time, not deep in the payment flow."""

    def test_minimum_required_fields_construct(self):
        net = ExtraNetwork(
            caip2="eip155:1187947933",
            asset="0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20",
        )
        assert net.asset_symbol == "USDC"  # defaults survive
        assert net.asset_decimals == 6

    def test_caip2_must_match_eip155_pattern(self):
        with pytest.raises(ValueError, match="caip2 must match"):
            ExtraNetwork(
                caip2="skale-europa",  # friendly name in the wrong slot
                asset="0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20",
            )

    def test_caip2_must_be_pure_digits_after_prefix(self):
        with pytest.raises(ValueError, match="caip2 must match"):
            ExtraNetwork(
                caip2="eip155:1187947933a",
                asset="0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20",
            )

    def test_asset_must_be_hex_address(self):
        with pytest.raises(ValueError, match="0x-prefixed"):
            ExtraNetwork(
                caip2="eip155:1187947933",
                asset="not-an-address",
            )

    def test_asset_must_be_full_length(self):
        with pytest.raises(ValueError, match="40-hex"):
            ExtraNetwork(
                caip2="eip155:1187947933",
                asset="0xdeadbeef",  # too short
            )

    def test_decimals_capped(self):
        with pytest.raises(ValueError):
            ExtraNetwork(
                caip2="eip155:1187947933",
                asset="0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20",
                asset_decimals=99,  # outside [0, 36]
            )


class TestMoneyParserRegistration:
    """The parser is what makes `parse_price(0.01, 'eip155:1187947933')`
    resolve to a SKALE AssetAmount instead of raising."""

    @staticmethod
    def _make_parser(cfg: ExtraNetwork):
        # Mirror the closure shape used in applications.py — keep the test
        # honest if the production parser ever drifts.
        def _parser(amount: float, network: str) -> AssetAmount | None:
            if network != cfg.caip2:
                return None
            atomic = round(amount * (10**cfg.asset_decimals))
            return AssetAmount(
                amount=str(atomic),
                asset=cfg.asset,
                extra={
                    "name": cfg.asset_name,
                    "version": cfg.asset_eip712_version,
                },
            )

        return _parser

    def test_parser_handles_target_network(self):
        cfg = ExtraNetwork(
            caip2="eip155:1187947933",
            asset="0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20",
            asset_name="Bridged USDC (SKALE Bridge)",
        )
        scheme = ExactEvmServerScheme()
        scheme.register_money_parser(self._make_parser(cfg))

        out = scheme.parse_price(0.01, "eip155:1187947933")
        assert out.amount == "10000"  # 0.01 USDC × 10^6 decimals
        assert out.asset == cfg.asset
        assert out.extra == {"name": cfg.asset_name, "version": "2"}

    def test_parser_falls_through_for_other_networks(self):
        # If the operator registers SKALE but the call is for Base, the
        # parser must return None so the SDK's default Base/USDC parser
        # gets a chance.
        cfg = ExtraNetwork(
            caip2="eip155:1187947933",
            asset="0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20",
        )
        scheme = ExactEvmServerScheme()
        scheme.register_money_parser(self._make_parser(cfg))

        # Base Sepolia is built into the SDK — should still resolve.
        out = scheme.parse_price(0.01, "eip155:84532")
        assert out.amount == "10000"
        assert out.asset.lower().startswith("0x")
        assert out.asset.lower() != cfg.asset.lower()

    def test_multiple_extra_networks_are_independent(self):
        # Two operator-registered networks shouldn't shadow each other.
        skale = ExtraNetwork(
            caip2="eip155:1187947933",
            asset="0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20",
            asset_name="Bridged USDC (SKALE)",
        )
        polygon = ExtraNetwork(
            caip2="eip155:137",
            asset="0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            asset_name="USD Coin",
        )
        scheme = ExactEvmServerScheme()
        scheme.register_money_parser(self._make_parser(skale))
        scheme.register_money_parser(self._make_parser(polygon))

        a = scheme.parse_price(0.01, "eip155:1187947933")
        b = scheme.parse_price(0.01, "eip155:137")
        assert a.asset == skale.asset
        assert b.asset == polygon.asset

    def test_decimals_other_than_6_scale_correctly(self):
        # e.g. WETH on SKALE is 18 decimals.
        weth = ExtraNetwork(
            caip2="eip155:1187947933",
            asset="0x7bD39ABBd0Dd13103542cAe3276C7fA332bCA486",
            asset_symbol="WETH",
            asset_name="Wrapped Ether",
            asset_decimals=18,
            asset_eip712_version="1",
        )
        scheme = ExactEvmServerScheme()
        scheme.register_money_parser(self._make_parser(weth))

        out = scheme.parse_price(0.001, "eip155:1187947933")
        # 0.001 × 10^18 = 10^15
        assert out.amount == str(10**15)


class TestDefaultExtraNetworkShipping:
    """The shipped default includes one worked example (SKALE Europa)
    so that operators see the shape, not just a docstring."""

    def test_default_extra_networks_contains_skale_europa(self):
        from bindu.settings import app_settings

        assert "skale-europa" in app_settings.x402.extra_networks
        skale = app_settings.x402.extra_networks["skale-europa"]
        assert skale.caip2 == "eip155:1187947933"
        # The asset address is mirrored from facilitator.x402.fi's /supported
        # response — if it ever drifts, this test will flag it.
        assert skale.asset == "0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20"
