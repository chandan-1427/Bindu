"""Tests for BoxdRuntimeProvider — all with the boxd SDK mocked."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from bindu.runtime import RuntimeConfig
from bindu.runtime.boxd_provider import BoxdRuntimeProvider


def _ok_exec_result():
    """Stub ExecResult with exit_code=0."""
    r = MagicMock()
    r.exit_code = 0
    r.success = True
    r.stdout = ""
    r.stderr = ""
    return r


# ── _resolve_vm ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_vm_creates_when_not_found(mock_boxd, fake_box):
    """If no VM with this name exists, create one."""
    from boxd.errors import NotFoundError

    mock_boxd.box.get.side_effect = NotFoundError("not found")
    p = BoxdRuntimeProvider()

    cfg = RuntimeConfig.from_dict({"provider": "boxd"})
    box = await p._resolve_vm(mock_boxd, "my-agent", cfg)

    mock_boxd.box.get.assert_awaited_once_with("my-agent")
    mock_boxd.box.create.assert_awaited_once()
    assert box is fake_box


@pytest.mark.asyncio
async def test_resolve_vm_reuses_when_found(mock_boxd, fake_box):
    """If a VM already exists, reuse it without creating."""
    p = BoxdRuntimeProvider()
    cfg = RuntimeConfig.from_dict({"provider": "boxd"})
    box = await p._resolve_vm(mock_boxd, "my-agent", cfg)

    mock_boxd.box.get.assert_awaited_once_with("my-agent")
    mock_boxd.box.create.assert_not_awaited()
    assert box is fake_box


@pytest.mark.asyncio
async def test_resolve_vm_passes_config(mock_boxd, fake_box):
    """vcpu / memory / disk / image / auto_suspend land in the create call."""
    from boxd.errors import NotFoundError

    mock_boxd.box.get.side_effect = NotFoundError("nope")
    p = BoxdRuntimeProvider()

    cfg = RuntimeConfig.from_dict(
        {
            "provider": "boxd",
            "image": "ghcr.io/me/agent:v1",
            "vcpu": 4,
            "memory": "8G",
            "disk": "40G",
            "auto_suspend": 30,
        }
    )
    await p._resolve_vm(mock_boxd, "my-agent", cfg)

    call = mock_boxd.box.create.await_args
    assert call.kwargs.get("name") == "my-agent"
    assert call.kwargs.get("image") == "ghcr.io/me/agent:v1"
    box_config = call.kwargs.get("config")
    assert box_config is not None
    assert box_config.vcpu == 4
    assert box_config.memory == "8G"
    assert box_config.disk == "40G"
    # auto_suspend goes through LifecycleConfig
    assert box_config.lifecycle is not None
    assert box_config.lifecycle.auto_suspend_timeout == 30


# ── _ship_source ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ship_source_writes_and_extracts(mock_boxd, fake_box, tmp_path):
    (tmp_path / "agent.py").write_text("# hi\n")
    fake_box.exec.return_value = _ok_exec_result()
    p = BoxdRuntimeProvider()

    await p._ship_source(fake_box, tmp_path)

    fake_box.write_file.assert_awaited_once()
    args = fake_box.write_file.await_args
    payload, dest = args.args[0], args.args[1]
    assert isinstance(payload, bytes)
    assert dest == "/tmp/source.tar.gz"

    # mkdir + tar extract should have been exec'd
    exec_calls = fake_box.exec.await_args_list
    assert any(c.args == ("mkdir", "-p", "/app") for c in exec_calls)
    assert any(
        c.args == ("tar", "xzf", "/tmp/source.tar.gz", "-C", "/app")
        for c in exec_calls
    )


# ── _install_deps ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_install_deps_with_pyproject(mock_boxd, fake_box):
    fake_box.exec.return_value = _ok_exec_result()
    p = BoxdRuntimeProvider()

    await p._install_deps(fake_box, has_pyproject=True, has_requirements=False)

    exec_calls = fake_box.exec.await_args_list
    # bindu must always be installed
    assert any(c.args == ("pip", "install", "bindu") for c in exec_calls)
    # And pip install -e .
    assert any(c.args == ("pip", "install", "-e", ".") for c in exec_calls)


@pytest.mark.asyncio
async def test_install_deps_with_requirements(mock_boxd, fake_box):
    fake_box.exec.return_value = _ok_exec_result()
    p = BoxdRuntimeProvider()

    await p._install_deps(fake_box, has_pyproject=False, has_requirements=True)

    exec_calls = fake_box.exec.await_args_list
    assert any(
        c.args == ("pip", "install", "-r", "/app/requirements.txt")
        for c in exec_calls
    )


@pytest.mark.asyncio
async def test_install_deps_pinned_bindu_version(mock_boxd, fake_box):
    fake_box.exec.return_value = _ok_exec_result()
    p = BoxdRuntimeProvider()

    await p._install_deps(
        fake_box,
        has_pyproject=False,
        has_requirements=False,
        bindu_version="0.2.5",
    )

    exec_calls = fake_box.exec.await_args_list
    assert any(c.args == ("pip", "install", "bindu==0.2.5") for c in exec_calls)


@pytest.mark.asyncio
async def test_install_deps_raises_on_failure(mock_boxd, fake_box):
    """Non-zero exit code from pip install should raise."""
    bad = MagicMock()
    bad.exit_code = 1
    bad.stderr = "boom"
    fake_box.exec.return_value = bad
    p = BoxdRuntimeProvider()

    with pytest.raises(RuntimeError, match="failed"):
        await p._install_deps(
            fake_box, has_pyproject=False, has_requirements=False
        )


# ── _start_agent ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_start_agent_execs_bindu_serve(mock_boxd, fake_box):
    p = BoxdRuntimeProvider()
    fake_box.exec.return_value = _ok_exec_result()

    await p._start_agent(
        fake_box,
        script="my_agent.py",
        env={"FOO": "bar"},
        public_url="https://my-agent.boxd.sh",
    )

    fake_box.exec.assert_awaited()
    cmd_call = fake_box.exec.await_args
    assert cmd_call.args[0] == "sh"
    assert cmd_call.args[1] == "-c"
    cmd_str = cmd_call.args[2]
    assert "bindu serve" in cmd_str
    assert "--script /app/my_agent.py" in cmd_str
    # env from caller plus the auto-injected BINDU_PUBLIC_URL
    env = cmd_call.kwargs.get("env")
    assert env is not None
    assert env.get("FOO") == "bar"
    assert env.get("BINDU_PUBLIC_URL") == "https://my-agent.boxd.sh"


@pytest.mark.asyncio
async def test_start_agent_raises_on_nonzero_exit(mock_boxd, fake_box):
    bad = MagicMock()
    bad.exit_code = 1
    bad.stderr = "boom"
    fake_box.exec.return_value = bad

    p = BoxdRuntimeProvider()
    with pytest.raises(RuntimeError, match="failed to start"):
        await p._start_agent(fake_box, script="agent.py")


# ── _wait_healthy ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_wait_healthy_returns_when_200(monkeypatch):
    """Health check returns once /health responds 200."""
    p = BoxdRuntimeProvider()

    call_count = {"n": 0}

    class _Resp:
        def __init__(self, status: int):
            self.status_code = status

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def get(self, url):
            call_count["n"] += 1
            if call_count["n"] < 3:
                return _Resp(503)
            return _Resp(200)

    monkeypatch.setattr(
        "bindu.runtime.boxd_provider.httpx.AsyncClient",
        lambda *a, **kw: _FakeClient(),
    )
    # Avoid the 1s sleep inside the loop in tests
    monkeypatch.setattr(
        "bindu.runtime.boxd_provider.asyncio.sleep",
        AsyncMock(return_value=None),
    )

    await p._wait_healthy("https://my-agent.boxd.sh", timeout=10.0)
    assert call_count["n"] == 3


@pytest.mark.asyncio
async def test_wait_healthy_times_out(monkeypatch):
    p = BoxdRuntimeProvider()

    class _Resp:
        status_code = 503

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def get(self, url):
            return _Resp()

    monkeypatch.setattr(
        "bindu.runtime.boxd_provider.httpx.AsyncClient",
        lambda *a, **kw: _FakeClient(),
    )
    monkeypatch.setattr(
        "bindu.runtime.boxd_provider.asyncio.sleep",
        AsyncMock(return_value=None),
    )

    with pytest.raises(TimeoutError, match="health"):
        await p._wait_healthy("https://my-agent.boxd.sh", timeout=0.1)
