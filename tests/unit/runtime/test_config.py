"""Tests for RuntimeConfig parsing & validation."""
import pytest

from bindu.runtime.config import RuntimeConfig, RuntimeConfigError


def test_default_provider_is_in_process():
    cfg = RuntimeConfig.from_dict(None)
    assert cfg.provider == "in-process"


def test_explicit_in_process():
    cfg = RuntimeConfig.from_dict({"provider": "in-process"})
    assert cfg.provider == "in-process"


def test_boxd_minimal():
    cfg = RuntimeConfig.from_dict({"provider": "boxd"})
    assert cfg.provider == "boxd"
    assert cfg.image is None
    assert cfg.vcpu == 2
    assert cfg.memory == "4G"
    assert cfg.disk == "20G"
    assert cfg.auto_suspend == 60
    assert cfg.on_exit == "suspend"
    assert cfg.env == {}


def test_boxd_full():
    cfg = RuntimeConfig.from_dict(
        {
            "provider": "boxd",
            "image": "ghcr.io/me/agent:v1",
            "vcpu": 4,
            "memory": "8G",
            "disk": "40G",
            "auto_suspend": 30,
            "on_exit": "destroy",
            "bindu_version": "0.2.0",
            "env": {"FOO": "bar"},
        }
    )
    assert cfg.provider == "boxd"
    assert cfg.image == "ghcr.io/me/agent:v1"
    assert cfg.vcpu == 4
    assert cfg.memory == "8G"
    assert cfg.disk == "40G"
    assert cfg.auto_suspend == 30
    assert cfg.on_exit == "destroy"
    assert cfg.bindu_version == "0.2.0"
    assert cfg.env == {"FOO": "bar"}


def test_unknown_provider_raises():
    with pytest.raises(RuntimeConfigError, match="unknown provider"):
        RuntimeConfig.from_dict({"provider": "nope"})


def test_invalid_on_exit_raises():
    with pytest.raises(RuntimeConfigError, match="on_exit"):
        RuntimeConfig.from_dict({"provider": "boxd", "on_exit": "explode"})


def test_zero_vcpu_raises():
    with pytest.raises(RuntimeConfigError, match="vcpu"):
        RuntimeConfig.from_dict({"provider": "boxd", "vcpu": 0})


def test_unknown_key_raises():
    with pytest.raises(RuntimeConfigError, match="unknown"):
        RuntimeConfig.from_dict({"provider": "boxd", "lol": "wut"})


def test_in_process_with_boxd_keys_raises():
    """Boxd-only keys are rejected when provider is in-process."""
    with pytest.raises(RuntimeConfigError, match="boxd"):
        RuntimeConfig.from_dict({"provider": "in-process", "image": "x"})
