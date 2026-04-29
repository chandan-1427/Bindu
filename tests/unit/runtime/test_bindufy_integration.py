"""Tests for bindufy() runtime dispatch."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from bindu.runtime.base import RuntimeHandle


def test_bindufy_default_uses_in_process(monkeypatch):
    """Without runtime= in config, bindufy uses today's _bindufy_core path."""
    import sys

    import bindu.penguin.bindufy  # noqa: F401  ensure submodule imported
    import bindu.runtime as br

    bm = sys.modules["bindu.penguin.bindufy"]

    called = {"core": False, "deploy": False}

    def fake_core(**kwargs):
        called["core"] = True
        return MagicMock()

    def fake_get_provider(name):
        called["deploy"] = True
        return MagicMock()

    monkeypatch.setattr(bm, "_bindufy_core", fake_core)
    monkeypatch.setattr(br, "get_provider", fake_get_provider)

    config = {
        "author": "test@example.com",
        "name": "test-agent",
        "deployment": {"url": "http://localhost:3773"},
    }
    bm.bindufy(config, lambda messages: "hi", run_server=False)
    assert called["core"] is True
    assert called["deploy"] is False


def test_bindufy_with_runtime_dispatches_to_provider(monkeypatch):
    """runtime={'provider': 'boxd'} → call provider.deploy, not _bindufy_core."""
    import sys

    import bindu.penguin.bindufy  # noqa: F401  ensure submodule imported
    import bindu.runtime as br

    bm = sys.modules["bindu.penguin.bindufy"]

    called = {"core": False, "deploy": False}

    def fake_core(**kwargs):
        called["core"] = True

    def fake_get_provider(name):
        provider = MagicMock()

        async def deploy(*a, **kw):
            called["deploy"] = True
            return RuntimeHandle(
                "test-agent", "https://test-agent.boxd.sh", "boxd", {}
            )

        provider.deploy = deploy

        async def stream_logs(*a, **kw):
            return
            yield  # noqa

        provider.stream_logs = stream_logs
        provider.on_exit = AsyncMock()
        return provider

    monkeypatch.setattr(bm, "_bindufy_core", fake_core)
    monkeypatch.setattr(br, "get_provider", fake_get_provider)

    async def fake_supervise(*a, **kw):
        return

    monkeypatch.setattr(bm, "_supervise", fake_supervise)

    config = {
        "author": "test@example.com",
        "name": "test-agent",
        "deployment": {"url": "http://localhost:3773"},
    }
    bm.bindufy(
        config,
        lambda messages: "hi",
        run_server=False,
        runtime={"provider": "boxd"},
    )
    assert called["deploy"] is True
    assert called["core"] is False


def test_bindufy_invalid_runtime_raises(monkeypatch):
    """Bad runtime config should fail fast at bindufy() call."""
    import sys

    import bindu.penguin.bindufy  # noqa: F401
    from bindu.runtime import RuntimeConfigError

    bm = sys.modules["bindu.penguin.bindufy"]

    config = {
        "author": "test@example.com",
        "name": "test-agent",
        "deployment": {"url": "http://localhost:3773"},
    }
    with pytest.raises(RuntimeConfigError):
        bm.bindufy(
            config,
            lambda messages: "hi",
            runtime={"provider": "totally-fake"},
        )
