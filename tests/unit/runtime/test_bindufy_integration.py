"""Tests for bindufy()'s deploy-capture sentinel.

When ``BINDU_DEPLOY_CAPTURE=<path>`` is set by ``bindu deploy``, bindufy
must dump the agent name and caller_dir to JSON and return without
performing any heavy runtime setup.
"""

import json
import sys
from unittest.mock import MagicMock

import pytest


def test_bindufy_default_runs_core(monkeypatch):
    """No capture sentinel set → bindufy delegates to _bindufy_core normally."""
    import bindu.penguin.bindufy  # noqa: F401  ensure submodule imported

    bm = sys.modules["bindu.penguin.bindufy"]
    monkeypatch.delenv("BINDU_DEPLOY_CAPTURE", raising=False)

    called = {"core": False}

    def fake_core(**kwargs):
        called["core"] = True
        return MagicMock()

    monkeypatch.setattr(bm, "_bindufy_core", fake_core)

    config = {
        "author": "test@example.com",
        "name": "test-agent",
        "deployment": {"url": "http://localhost:3773"},
    }
    bm.bindufy(config, lambda messages: "hi", run_server=False)
    assert called["core"] is True


def test_bindufy_with_capture_writes_json_and_returns(monkeypatch, tmp_path):
    """Capture env var set → bindufy writes name + caller_dir, skips core."""
    import bindu.penguin.bindufy  # noqa: F401

    bm = sys.modules["bindu.penguin.bindufy"]

    capture_path = tmp_path / "captured.json"
    monkeypatch.setenv("BINDU_DEPLOY_CAPTURE", str(capture_path))

    called = {"core": False}

    def fake_core(**kwargs):
        called["core"] = True

    monkeypatch.setattr(bm, "_bindufy_core", fake_core)

    config = {
        "author": "test@example.com",
        "name": "test-agent",
        "deployment": {"url": "http://localhost:3773"},
    }
    result = bm.bindufy(config, lambda messages: "hi", run_server=False)

    assert result is None
    assert called["core"] is False
    assert capture_path.exists()
    data = json.loads(capture_path.read_text())
    assert data["agent_name"] == "test-agent"
    assert "caller_dir" in data


def test_bindufy_capture_requires_name(monkeypatch, tmp_path):
    """Capture mode raises if config has no name/id (deploy needs a name)."""
    import bindu.penguin.bindufy  # noqa: F401

    bm = sys.modules["bindu.penguin.bindufy"]

    monkeypatch.setenv("BINDU_DEPLOY_CAPTURE", str(tmp_path / "captured.json"))

    config = {"author": "test@example.com"}  # no name / id
    with pytest.raises(ValueError, match="name"):
        bm.bindufy(config, lambda messages: "hi", run_server=False)
