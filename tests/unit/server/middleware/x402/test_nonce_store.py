"""Tests for the x402 nonce store (replay prevention)."""

from __future__ import annotations

import asyncio
import time

import pytest

from bindu.server.middleware.x402.nonce_store import (
    InMemoryNonceStore,
    _key,
    make_nonce_store,
)


pytestmark = pytest.mark.asyncio


class TestKeyConstruction:
    """The key shape is part of the public contract — operators may inspect
    Redis to debug. Keep it stable and well-namespaced."""

    def test_key_is_prefixed_and_lowercased(self):
        key = _key("eip155:8453", "0xABCDEF", "0xDEADBEEF")
        assert key == "bindu:x402:nonce:eip155:8453:0xabcdef:0xdeadbeef"

    def test_different_assets_with_same_nonce_do_not_collide(self):
        # Same nonce on two different ERC-20s must not be mistaken for a replay.
        a = _key("eip155:8453", "0xUSDC", "0x01")
        b = _key("eip155:8453", "0xWETH", "0x01")
        assert a != b

    def test_different_networks_with_same_nonce_do_not_collide(self):
        a = _key("eip155:8453", "0xUSDC", "0x01")
        b = _key("eip155:84532", "0xUSDC", "0x01")
        assert a != b


class TestInMemoryNonceStore:
    async def test_first_claim_succeeds(self):
        store = InMemoryNonceStore()
        ok = await store.claim("eip155:8453", "0xUSDC", "0xDEAD", ttl_seconds=60)
        assert ok is True

    async def test_second_claim_of_same_nonce_fails(self):
        # This is the bug we're fixing: in v0.2.1 the same X-PAYMENT header
        # could be replayed indefinitely. The store must reject the second
        # claim even if the first hasn't expired yet.
        store = InMemoryNonceStore()
        await store.claim("eip155:8453", "0xUSDC", "0xDEAD", ttl_seconds=60)
        replay = await store.claim("eip155:8453", "0xUSDC", "0xDEAD", ttl_seconds=60)
        assert replay is False

    async def test_claim_succeeds_again_after_ttl_expires(self):
        store = InMemoryNonceStore()
        await store.claim("eip155:8453", "0xUSDC", "0xDEAD", ttl_seconds=1)
        # Force expiry by reaching into the store; sleeping in tests is brittle.
        store._seen["bindu:x402:nonce:eip155:8453:0xusdc:0xdead"] = time.monotonic() - 1
        ok = await store.claim("eip155:8453", "0xUSDC", "0xDEAD", ttl_seconds=60)
        assert ok is True

    async def test_concurrent_claims_resolve_to_exactly_one_winner(self):
        # Two workers see the same X-PAYMENT in flight. Only one can win.
        store = InMemoryNonceStore()
        results = await asyncio.gather(
            *[
                store.claim("eip155:8453", "0xUSDC", "0xCAFE", ttl_seconds=60)
                for _ in range(20)
            ]
        )
        assert sum(1 for r in results if r) == 1

    async def test_different_nonces_are_independent(self):
        store = InMemoryNonceStore()
        ok1 = await store.claim("eip155:8453", "0xUSDC", "0xAAA", ttl_seconds=60)
        ok2 = await store.claim("eip155:8453", "0xUSDC", "0xBBB", ttl_seconds=60)
        assert (ok1, ok2) == (True, True)


class TestFactory:
    def test_no_redis_url_yields_in_memory_store(self):
        store = make_nonce_store(None)
        assert isinstance(store, InMemoryNonceStore)

    def test_redis_url_yields_redis_store(self):
        # No network call — RedisNonceStore is lazy and only connects on first claim.
        from bindu.server.middleware.x402.nonce_store import RedisNonceStore

        store = make_nonce_store("redis://localhost:6379/0")
        assert isinstance(store, RedisNonceStore)
