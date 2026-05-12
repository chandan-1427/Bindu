# |---------------------------------------------------------|
# |                                                         |
# |                 Give Feedback / Get Help                |
# | https://github.com/getbindu/Bindu/issues/new/choose    |
# |                                                         |
# |---------------------------------------------------------|
#
#  Thank you users! We ❤️ you! - 🌻

"""Nonce store for x402 replay-prevention.

The x402 protocol issues an EIP-3009 ``TransferWithAuthorization`` to the
payer. Its ``nonce`` is a 32-byte hex value that the on-chain contract
will reject if presented twice — *eventually*. Before settlement, though,
the same payload can be presented to a resource server many times within
the ``validBefore`` window. Without server-side deduplication, one
payment buys unlimited work until the window closes.

This module provides a small interface (`NonceStore`) with two backends:

* :class:`RedisNonceStore` — production. ``SET NX EX`` is atomic and
  cluster-safe.
* :class:`InMemoryNonceStore` — tests and single-process deployments.
  TTLs honored, but state lives in this process.

Both expose the same coroutine: :meth:`claim`. It returns ``True`` if the
caller is the first to claim the (network, asset, nonce) triple, and
``False`` if anyone else got there first. The middleware rejects the
request on ``False``.
"""

from __future__ import annotations

import asyncio
import time
from typing import Protocol

import redis.asyncio as aioredis

from bindu.utils.logging import get_logger

logger = get_logger("bindu.server.middleware.x402.nonce_store")

NONCE_KEY_PREFIX = "bindu:x402:nonce"


def _key(network: str, asset: str, nonce: str) -> str:
    """Build the canonical nonce key.

    The asset is included so the same nonce on two different token
    contracts cannot collide.
    """
    return f"{NONCE_KEY_PREFIX}:{network}:{asset.lower()}:{nonce.lower()}"


class NonceStore(Protocol):
    """Protocol implemented by every nonce backend."""

    async def claim(
        self, network: str, asset: str, nonce: str, ttl_seconds: int
    ) -> bool:
        """Atomically claim a nonce.

        Returns:
            True if this call was the first to claim it; False if the
            nonce was already present (replay attempt).
        """
        ...


class InMemoryNonceStore:
    """Single-process nonce store backed by a dict.

    Suitable for tests and deployments running exactly one Bindu process.
    A horizontally-scaled deployment must use :class:`RedisNonceStore` —
    two processes each holding their own dict will accept the same nonce
    twice.
    """

    def __init__(self) -> None:
        """Start with an empty seen-set and a fresh asyncio lock."""
        self._seen: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def claim(
        self, network: str, asset: str, nonce: str, ttl_seconds: int
    ) -> bool:
        """Return True on a fresh claim; False if the nonce is already present."""
        key = _key(network, asset, nonce)
        now = time.monotonic()
        async with self._lock:
            # Lazy purge — keeps the dict from growing without bound.
            self._purge_expired(now)
            if key in self._seen:
                return False
            self._seen[key] = now + ttl_seconds
            return True

    def _purge_expired(self, now: float) -> None:
        expired = [k for k, exp in self._seen.items() if exp <= now]
        for k in expired:
            del self._seen[k]


class RedisNonceStore:
    """Redis-backed nonce store using ``SET NX EX``.

    The combination is atomic on a single Redis instance: ``NX`` only
    sets the key when it doesn't exist, and ``EX`` sets the TTL in the
    same round-trip. ``redis.set(..., nx=True, ex=ttl)`` returns truthy
    on a fresh claim and falsy when the key already existed.
    """

    def __init__(self, redis_url: str) -> None:
        """Record the connection URL; the client itself is built lazily on first claim."""
        self._redis_url = redis_url
        self._client: aioredis.Redis | None = None
        self._connect_lock = asyncio.Lock()

    async def _get_client(self) -> aioredis.Redis:
        if self._client is not None:
            return self._client
        async with self._connect_lock:
            if self._client is None:
                self._client = aioredis.from_url(
                    self._redis_url, encoding="utf-8", decode_responses=True
                )
        return self._client

    async def claim(
        self, network: str, asset: str, nonce: str, ttl_seconds: int
    ) -> bool:
        """Return True on a fresh claim; False if Redis already holds the key."""
        client = await self._get_client()
        key = _key(network, asset, nonce)
        # SET NX EX is atomic — no race between the existence check and the
        # write. Redis returns None when NX fails, "OK" on success.
        result = await client.set(key, "1", nx=True, ex=ttl_seconds)
        return result is not None

    async def close(self) -> None:
        """Release the Redis connection. Idempotent."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def make_nonce_store(redis_url: str | None) -> NonceStore:
    """Pick a backend based on whether Redis is configured.

    Operators running a multi-process deployment should always have a
    Redis URL configured; otherwise nonce dedupe is per-process and a
    replay against a sibling process will not be caught.
    """
    if redis_url:
        logger.info("x402 nonce store: Redis backend (%s)", redis_url)
        return RedisNonceStore(redis_url)
    logger.warning(
        "x402 nonce store: in-memory backend — replay protection is "
        "per-process only. Configure Redis for horizontal deployments."
    )
    return InMemoryNonceStore()
