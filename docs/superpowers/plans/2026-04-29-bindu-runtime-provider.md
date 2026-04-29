# Bindu RuntimeProvider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `RuntimeProvider` abstraction to bindu, with a `BoxdRuntimeProvider` that runs a bindu agent inside a boxd microVM (sandbox-as-runtime). When `runtime={"provider": "boxd", ...}` is set, `bindufy()` ships the user's source to a VM, starts the agent there, and the host process becomes a deploy/supervise tool.

**Architecture:** The host bindu's job ends after deploy. The agent inside the VM is a vanilla bindu instance running `bindufy(config, handler)` — no in-VM awareness it's "in a sandbox." DID/x402/OAuth state lives in the VM. The host packages source, ships via `box.write_file`, runs `pip install` + `bindu serve --script` via `box.exec`, health-checks the public URL, and streams logs. On Ctrl-C: detach (default) and let boxd auto-suspend, or destroy.

**Tech Stack:** Python 3.12+, `pytest` + `pytest-asyncio` (asyncio_mode=strict), `boxd` SDK from `~/boxd/sdk/python` (editable install), `argparse` for CLI, `tarfile` + `gzip` for source packaging, `httpx` for health checks.

**Spec reference:** `docs/superpowers/specs/2026-04-29-bindu-runtime-design.md`

---

## File Structure

**New files:**
- `bindu/runtime/__init__.py` — public API
- `bindu/runtime/base.py` — `RuntimeProvider` ABC, `RuntimeHandle`, registry
- `bindu/runtime/config.py` — `RuntimeConfig` dataclass + validation
- `bindu/runtime/source_packager.py` — project root discovery, ignore handling, tarball build
- `bindu/runtime/in_process.py` — `InProcessRuntimeProvider` (default; runs the existing path)
- `bindu/runtime/boxd_provider.py` — `BoxdRuntimeProvider`
- `bindu/cli/serve.py` — `bindu serve --script <path>` entry point
- `tests/unit/runtime/__init__.py`
- `tests/unit/runtime/conftest.py` — shared fixtures (mock boxd SDK)
- `tests/unit/runtime/test_config.py`
- `tests/unit/runtime/test_base.py`
- `tests/unit/runtime/test_source_packager.py`
- `tests/unit/runtime/test_in_process.py`
- `tests/unit/runtime/test_boxd_provider.py`
- `tests/unit/runtime/test_provider_contract.py` — abstract suite any provider must satisfy
- `tests/unit/runtime/test_cli_serve_script.py`
- `tests/unit/runtime/test_bindufy_integration.py`
- `tests/e2e/runtime/__init__.py`
- `tests/e2e/runtime/test_boxd_e2e.py` — gated, opt-in
- `docs/runtime/README.md`
- `docs/runtime/boxd.md`
- `docs/runtime/custom-image.md`

**Modified:**
- `bindu/cli/__init__.py` — wire in `serve --script`, plus `shell` and `logs` subcommands
- `bindu/penguin/bindufy.py` — detect `runtime` config, dispatch to provider
- `bindu/common/models.py` — re-export `RuntimeConfig` for convenience (optional)
- `bindu/penguin/config_validator.py` — validate `runtime` block
- `pyproject.toml` — add `boxd` as optional extra under `[project.optional-dependencies]`

---

## Pre-flight (one-time, not a task)

These commands set up the working environment. The executor runs them once before starting Task 1.

```bash
cd ~/bindu
pip install -e ~/boxd/sdk/python    # editable boxd SDK
pip install -e ".[dev]"              # bindu dev deps
pytest tests/unit -x --no-header -q | tail -10   # baseline must pass
```

If baseline tests don't pass, stop and surface the failure — do not proceed.

---

## Task 1: Skeleton — package + test conftest

**Files:**
- Create: `bindu/runtime/__init__.py`
- Create: `tests/unit/runtime/__init__.py`
- Create: `tests/unit/runtime/conftest.py`
- Test: `tests/unit/runtime/test_smoke.py` (temporary, deleted at end of task)

- [ ] **Step 1: Write smoke test**

`tests/unit/runtime/test_smoke.py`:
```python
"""Smoke test: package importable. Deleted after Task 1."""

def test_package_importable():
    import bindu.runtime
    assert bindu.runtime is not None
```

- [ ] **Step 2: Run, expect FAIL (module not found)**

```bash
pytest tests/unit/runtime/test_smoke.py -v
```
Expected: `ModuleNotFoundError: No module named 'bindu.runtime'`

- [ ] **Step 3: Create empty package files**

`bindu/runtime/__init__.py`:
```python
"""Runtime provider abstraction for bindu agents.

A `RuntimeProvider` controls *where* a bindu agent's process runs.
The default (`InProcessRuntimeProvider`) runs the agent in the host
process, matching today's behavior. `BoxdRuntimeProvider` runs the
agent inside a boxd microVM.
"""
```

`tests/unit/runtime/__init__.py`: empty file.

`tests/unit/runtime/conftest.py`:
```python
"""Fixtures for runtime provider unit tests."""
```

- [ ] **Step 4: Run smoke test, expect PASS**

```bash
pytest tests/unit/runtime/test_smoke.py -v
```
Expected: 1 passed.

- [ ] **Step 5: Delete smoke test**

```bash
rm tests/unit/runtime/test_smoke.py
```

- [ ] **Step 6: Commit**

```bash
git add bindu/runtime/__init__.py tests/unit/runtime/
git commit -m "feat(runtime): scaffold runtime provider package"
```

---

## Task 2: `RuntimeConfig` dataclass

**Files:**
- Create: `bindu/runtime/config.py`
- Test: `tests/unit/runtime/test_config.py`

- [ ] **Step 1: Write tests**

`tests/unit/runtime/test_config.py`:
```python
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
    cfg = RuntimeConfig.from_dict({
        "provider": "boxd",
        "image": "ghcr.io/me/agent:v1",
        "vcpu": 4,
        "memory": "8G",
        "disk": "40G",
        "auto_suspend": 30,
        "on_exit": "destroy",
        "bindu_version": "0.2.0",
        "env": {"FOO": "bar"},
    })
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


def test_negative_vcpu_raises():
    with pytest.raises(RuntimeConfigError, match="vcpu"):
        RuntimeConfig.from_dict({"provider": "boxd", "vcpu": 0})


def test_unknown_key_raises():
    with pytest.raises(RuntimeConfigError, match="unknown"):
        RuntimeConfig.from_dict({"provider": "boxd", "lol": "wut"})


def test_in_process_with_boxd_keys_raises():
    """Boxd-only keys are rejected when provider is in-process."""
    with pytest.raises(RuntimeConfigError, match="boxd"):
        RuntimeConfig.from_dict({"provider": "in-process", "image": "x"})
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pytest tests/unit/runtime/test_config.py -v
```
Expected: ImportError on first test.

- [ ] **Step 3: Implement `RuntimeConfig`**

`bindu/runtime/config.py`:
```python
"""RuntimeConfig — parses and validates the `runtime=` block in bindufy()."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal

KNOWN_PROVIDERS = ("in-process", "boxd")
KNOWN_ON_EXIT = ("suspend", "destroy", "detach")
BOXD_ONLY_KEYS = {
    "image", "vcpu", "memory", "disk",
    "auto_suspend", "on_exit", "bindu_version", "env",
}
ALL_KEYS = BOXD_ONLY_KEYS | {"provider"}


class RuntimeConfigError(ValueError):
    """Raised on invalid runtime configuration."""


@dataclass(frozen=True)
class RuntimeConfig:
    provider: Literal["in-process", "boxd"] = "in-process"
    image: str | None = None
    vcpu: int = 2
    memory: str = "4G"
    disk: str = "20G"
    auto_suspend: int = 60
    on_exit: Literal["suspend", "destroy", "detach"] = "suspend"
    bindu_version: str | None = None
    env: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: dict[str, Any] | None) -> "RuntimeConfig":
        if raw is None:
            return cls()
        unknown = set(raw) - ALL_KEYS
        if unknown:
            raise RuntimeConfigError(f"unknown runtime keys: {sorted(unknown)}")

        provider = raw.get("provider", "in-process")
        if provider not in KNOWN_PROVIDERS:
            raise RuntimeConfigError(
                f"unknown provider '{provider}'; must be one of {KNOWN_PROVIDERS}"
            )

        if provider == "in-process":
            misplaced = set(raw) & BOXD_ONLY_KEYS
            if misplaced:
                raise RuntimeConfigError(
                    f"keys {sorted(misplaced)} require provider='boxd'"
                )
            return cls(provider="in-process")

        on_exit = raw.get("on_exit", "suspend")
        if on_exit not in KNOWN_ON_EXIT:
            raise RuntimeConfigError(
                f"on_exit must be one of {KNOWN_ON_EXIT}, got {on_exit!r}"
            )

        vcpu = int(raw.get("vcpu", 2))
        if vcpu <= 0:
            raise RuntimeConfigError(f"vcpu must be positive, got {vcpu}")

        return cls(
            provider="boxd",
            image=raw.get("image"),
            vcpu=vcpu,
            memory=raw.get("memory", "4G"),
            disk=raw.get("disk", "20G"),
            auto_suspend=int(raw.get("auto_suspend", 60)),
            on_exit=on_exit,
            bindu_version=raw.get("bindu_version"),
            env=dict(raw.get("env", {})),
        )
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_config.py -v
```
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/config.py tests/unit/runtime/test_config.py
git commit -m "feat(runtime): RuntimeConfig with provider validation"
```

---

## Task 3: `RuntimeHandle` + `RuntimeProvider` ABC + registry

**Files:**
- Create: `bindu/runtime/base.py`
- Test: `tests/unit/runtime/test_base.py`
- Modify: `bindu/runtime/__init__.py` — re-export public names

- [ ] **Step 1: Write tests**

`tests/unit/runtime/test_base.py`:
```python
"""Tests for RuntimeHandle, RuntimeProvider ABC, and provider registry."""
import pytest
from bindu.runtime.base import (
    RuntimeHandle,
    RuntimeProvider,
    register_provider,
    get_provider,
    UnknownProviderError,
    _registry,
)


def test_runtime_handle_fields():
    h = RuntimeHandle(
        name="x", url="http://localhost:3773", provider="in-process", metadata={}
    )
    assert h.name == "x"
    assert h.url == "http://localhost:3773"


def test_abc_cannot_be_instantiated_directly():
    with pytest.raises(TypeError):
        RuntimeProvider()  # type: ignore[abstract]


def test_register_and_get_provider():
    class FakeProvider(RuntimeProvider):
        async def deploy(self, *a, **kw): ...
        async def health(self, *a, **kw): ...
        async def stream_logs(self, *a, **kw): ...
        async def on_exit(self, *a, **kw): ...

    register_provider("fake", FakeProvider)
    try:
        p = get_provider("fake")
        assert isinstance(p, FakeProvider)
    finally:
        _registry.pop("fake", None)


def test_unknown_provider_raises():
    with pytest.raises(UnknownProviderError, match="absolutely-not-a-provider"):
        get_provider("absolutely-not-a-provider")
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pytest tests/unit/runtime/test_base.py -v
```
Expected: ImportError.

- [ ] **Step 3: Implement `base.py`**

`bindu/runtime/base.py`:
```python
"""RuntimeProvider abstraction + registry.

A `RuntimeProvider` controls where a bindu agent's runtime lives:
- `InProcessRuntimeProvider`: runs in the host process (today's default)
- `BoxdRuntimeProvider`: runs inside a boxd VM

Providers are registered by string name; `bindufy()` dispatches by
`runtime.provider`. New providers (e2b, modal, ...) plug in without
core bindu changes.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Literal

from bindu.runtime.config import RuntimeConfig


@dataclass
class RuntimeHandle:
    """Reference to a deployed agent runtime.

    Attributes:
        name: agent name (matches config["name"])
        url: public URL where the agent serves (e.g. https://my-agent.boxd.sh)
        provider: provider id string ("boxd", "in-process", ...)
        metadata: provider-specific (vm_id, public_ip, ...). Inspectable; do not rely on shape.
    """
    name: str
    url: str
    provider: str
    metadata: dict[str, Any] = field(default_factory=dict)


class UnknownProviderError(LookupError):
    """Raised when `get_provider(name)` finds no registered provider."""


class RuntimeProvider(ABC):
    """Abstract runtime provider — subclass per backend."""

    @abstractmethod
    async def deploy(
        self,
        agent_name: str,
        source_dir: Path | None,
        config: RuntimeConfig,
        env: dict[str, str] | None = None,
    ) -> RuntimeHandle:
        """Deploy the agent. Returns a handle once the agent is healthy."""

    @abstractmethod
    async def health(self, handle: RuntimeHandle) -> bool:
        """Return True if the agent at `handle` is reachable & healthy."""

    @abstractmethod
    async def stream_logs(
        self, handle: RuntimeHandle, follow: bool = True
    ) -> AsyncIterator[bytes]:
        """Yield log chunks from the agent's runtime."""

    @abstractmethod
    async def on_exit(
        self,
        handle: RuntimeHandle,
        mode: Literal["suspend", "destroy", "detach"],
    ) -> None:
        """Apply the user's on-exit policy when the host process is shutting down."""


# ── Provider registry ──────────────────────────────────────────────

_registry: dict[str, type[RuntimeProvider]] = {}


def register_provider(name: str, cls: type[RuntimeProvider]) -> None:
    """Register a RuntimeProvider class under `name`. Replaces any prior registration."""
    _registry[name] = cls


def get_provider(name: str) -> RuntimeProvider:
    """Instantiate the provider registered under `name`."""
    if name not in _registry:
        raise UnknownProviderError(
            f"no runtime provider registered for '{name}'; "
            f"known: {sorted(_registry)}"
        )
    return _registry[name]()
```

`bindu/runtime/__init__.py`:
```python
"""Runtime provider abstraction for bindu agents."""
from bindu.runtime.base import (
    RuntimeHandle,
    RuntimeProvider,
    UnknownProviderError,
    register_provider,
    get_provider,
)
from bindu.runtime.config import RuntimeConfig, RuntimeConfigError

__all__ = [
    "RuntimeHandle",
    "RuntimeProvider",
    "UnknownProviderError",
    "register_provider",
    "get_provider",
    "RuntimeConfig",
    "RuntimeConfigError",
]
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_base.py tests/unit/runtime/test_config.py -v
```
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/base.py bindu/runtime/__init__.py tests/unit/runtime/test_base.py
git commit -m "feat(runtime): RuntimeProvider ABC + RuntimeHandle + registry"
```

---

## Task 4: Source packager — project root discovery

**Files:**
- Create: `bindu/runtime/source_packager.py`
- Test: `tests/unit/runtime/test_source_packager.py` (this task adds first tests)

- [ ] **Step 1: Write tests**

`tests/unit/runtime/test_source_packager.py`:
```python
"""Source packager tests."""
from pathlib import Path
import pytest
from bindu.runtime.source_packager import find_project_root


def test_finds_pyproject(tmp_path: Path):
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")
    sub = tmp_path / "src" / "deep"
    sub.mkdir(parents=True)
    script = sub / "agent.py"
    script.write_text("# agent")
    assert find_project_root(script) == tmp_path


def test_finds_setup_py(tmp_path: Path):
    (tmp_path / "setup.py").write_text("from setuptools import setup\n")
    script = tmp_path / "agent.py"
    script.write_text("# agent")
    assert find_project_root(script) == tmp_path


def test_finds_requirements_txt(tmp_path: Path):
    (tmp_path / "requirements.txt").write_text("httpx\n")
    script = tmp_path / "agent.py"
    script.write_text("# agent")
    assert find_project_root(script) == tmp_path


def test_finds_git(tmp_path: Path):
    (tmp_path / ".git").mkdir()
    script = tmp_path / "sub" / "agent.py"
    script.parent.mkdir()
    script.write_text("# agent")
    assert find_project_root(script) == tmp_path


def test_falls_back_to_script_dir(tmp_path: Path):
    """No marker found → script's parent is the root."""
    sub = tmp_path / "lonely"
    sub.mkdir()
    script = sub / "agent.py"
    script.write_text("# agent")
    assert find_project_root(script) == sub


def test_marker_priority(tmp_path: Path):
    """pyproject.toml wins over setup.py at the same level."""
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")
    (tmp_path / "setup.py").write_text("from setuptools import setup\n")
    script = tmp_path / "agent.py"
    script.write_text("# agent")
    assert find_project_root(script) == tmp_path
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pytest tests/unit/runtime/test_source_packager.py -v
```

- [ ] **Step 3: Implement `find_project_root`**

`bindu/runtime/source_packager.py`:
```python
"""Source packaging for runtime providers.

Three pieces:
- `find_project_root(script_path)`: walks up from the user's entry script to
  find a project root marker (pyproject.toml, setup.py, requirements.txt, .git).
- `should_include(path, root)`: applies default ignores + .gitignore + .binduignore.
- `build_tarball(root)`: returns gzipped tar bytes of the project tree.
"""
from __future__ import annotations
from pathlib import Path

# Order = priority. First match wins.
_ROOT_MARKERS = ("pyproject.toml", "setup.py", "requirements.txt", ".git")


def find_project_root(script_path: Path) -> Path:
    """Walk up from `script_path` looking for a project-root marker.

    Falls back to the script's parent directory if nothing matches.
    """
    script_path = Path(script_path).resolve()
    candidate = script_path.parent
    while True:
        for marker in _ROOT_MARKERS:
            if (candidate / marker).exists():
                return candidate
        parent = candidate.parent
        if parent == candidate:
            return script_path.parent
        candidate = parent
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_source_packager.py -v
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/source_packager.py tests/unit/runtime/test_source_packager.py
git commit -m "feat(runtime): project-root discovery for source packager"
```

---

## Task 5: Source packager — ignore handling

**Files:**
- Modify: `bindu/runtime/source_packager.py` — add `should_include`
- Modify: `tests/unit/runtime/test_source_packager.py` — add ignore tests

- [ ] **Step 1: Add tests**

Append to `tests/unit/runtime/test_source_packager.py`:
```python
from bindu.runtime.source_packager import should_include, IgnoreSpec


def _make_spec(root: Path, gitignore: str = "", binduignore: str = "") -> IgnoreSpec:
    if gitignore:
        (root / ".gitignore").write_text(gitignore)
    if binduignore:
        (root / ".binduignore").write_text(binduignore)
    return IgnoreSpec.load(root)


def test_default_ignores_pycache(tmp_path: Path):
    spec = _make_spec(tmp_path)
    assert not should_include(tmp_path / "x" / "__pycache__" / "y.pyc", tmp_path, spec)


def test_default_ignores_git(tmp_path: Path):
    spec = _make_spec(tmp_path)
    assert not should_include(tmp_path / ".git" / "config", tmp_path, spec)


def test_default_ignores_venv(tmp_path: Path):
    spec = _make_spec(tmp_path)
    assert not should_include(tmp_path / ".venv" / "bin" / "python", tmp_path, spec)
    assert not should_include(tmp_path / "venv" / "bin" / "python", tmp_path, spec)


def test_default_ignores_node_modules(tmp_path: Path):
    spec = _make_spec(tmp_path)
    assert not should_include(tmp_path / "node_modules" / "x" / "index.js", tmp_path, spec)


def test_default_ignores_pyc_files(tmp_path: Path):
    spec = _make_spec(tmp_path)
    assert not should_include(tmp_path / "module.pyc", tmp_path, spec)


def test_includes_regular_python(tmp_path: Path):
    spec = _make_spec(tmp_path)
    assert should_include(tmp_path / "agent.py", tmp_path, spec)


def test_includes_dotenv(tmp_path: Path):
    """`.env` is shipped (agents need their secrets)."""
    spec = _make_spec(tmp_path)
    assert should_include(tmp_path / ".env", tmp_path, spec)


def test_gitignore_pattern(tmp_path: Path):
    spec = _make_spec(tmp_path, gitignore="*.log\nsecrets/\n")
    assert not should_include(tmp_path / "app.log", tmp_path, spec)
    assert not should_include(tmp_path / "secrets" / "key.pem", tmp_path, spec)
    assert should_include(tmp_path / "agent.py", tmp_path, spec)


def test_binduignore_pattern(tmp_path: Path):
    spec = _make_spec(tmp_path, binduignore="data/\n")
    assert not should_include(tmp_path / "data" / "big.csv", tmp_path, spec)


def test_binduignore_overrides_default(tmp_path: Path):
    """If user does NOT list a default-ignored path in .binduignore, it stays ignored."""
    spec = _make_spec(tmp_path, binduignore="other/\n")
    assert not should_include(tmp_path / "__pycache__" / "x.pyc", tmp_path, spec)
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pytest tests/unit/runtime/test_source_packager.py -v
```

- [ ] **Step 3: Implement `should_include` + `IgnoreSpec`**

Append to `bindu/runtime/source_packager.py`:
```python
import fnmatch
from dataclasses import dataclass, field

# Hard-coded default excludes — always applied, even before .gitignore.
_DEFAULT_IGNORE_DIRS = frozenset({
    "__pycache__", ".git", ".venv", "venv", "node_modules",
    ".pytest_cache", ".mypy_cache", ".ruff_cache",
})
_DEFAULT_IGNORE_SUFFIXES = (".pyc", ".pyo", ".log", ".sqlite", ".db")


@dataclass(frozen=True)
class IgnoreSpec:
    """Combined default + .gitignore + .binduignore patterns."""
    patterns: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def load(cls, root: Path) -> "IgnoreSpec":
        lines: list[str] = []
        for filename in (".gitignore", ".binduignore"):
            f = root / filename
            if f.exists():
                lines.extend(
                    line.strip()
                    for line in f.read_text().splitlines()
                    if line.strip() and not line.strip().startswith("#")
                )
        return cls(patterns=tuple(lines))


def should_include(path: Path, root: Path, spec: IgnoreSpec) -> bool:
    """Decide whether `path` should be shipped, given default + user ignores.

    `path` may be a file or a directory. Returns False if any default-ignored
    directory appears in its relative parts, or if any pattern in `spec` matches.
    """
    rel = path.relative_to(root)
    parts = rel.parts

    # Default dir excludes — match any segment.
    if any(p in _DEFAULT_IGNORE_DIRS for p in parts):
        return False

    # Default suffix excludes.
    if path.suffix in _DEFAULT_IGNORE_SUFFIXES:
        return False

    # User patterns from .gitignore / .binduignore.
    rel_str = str(rel).replace("\\", "/")
    for pat in spec.patterns:
        if pat.endswith("/"):
            # Directory pattern: "secrets/" matches secrets/*.
            dir_pat = pat.rstrip("/")
            if rel_str == dir_pat or rel_str.startswith(dir_pat + "/"):
                return False
        elif fnmatch.fnmatch(rel_str, pat) or fnmatch.fnmatch(rel.name, pat):
            return False

    return True
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_source_packager.py -v
```
Expected: 16 passed (6 from Task 4 + 10 here).

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/source_packager.py tests/unit/runtime/test_source_packager.py
git commit -m "feat(runtime): ignore handling for source packager"
```

---

## Task 6: Source packager — build tarball

**Files:**
- Modify: `bindu/runtime/source_packager.py` — add `build_tarball`
- Modify: `tests/unit/runtime/test_source_packager.py` — add tarball tests

- [ ] **Step 1: Add tests**

Append to `tests/unit/runtime/test_source_packager.py`:
```python
import tarfile
import io
from bindu.runtime.source_packager import build_tarball, SourceTooLargeError


def test_build_tarball_basic(tmp_path: Path):
    (tmp_path / "agent.py").write_text("print('hi')\n")
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")
    sub = tmp_path / "lib"
    sub.mkdir()
    (sub / "util.py").write_text("# util\n")

    blob = build_tarball(tmp_path)
    assert isinstance(blob, bytes)
    assert len(blob) > 0

    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        names = sorted(tar.getnames())
    assert "agent.py" in names
    assert "pyproject.toml" in names
    assert "lib/util.py" in names


def test_build_tarball_skips_ignored(tmp_path: Path):
    (tmp_path / "agent.py").write_text("# agent\n")
    pcache = tmp_path / "__pycache__"
    pcache.mkdir()
    (pcache / "agent.cpython-312.pyc").write_bytes(b"\x00" * 100)
    (tmp_path / ".gitignore").write_text("secrets/\n")
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    (secrets / "key.pem").write_text("hush")

    blob = build_tarball(tmp_path)

    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        names = sorted(tar.getnames())
    assert "agent.py" in names
    assert not any(n.startswith("__pycache__") for n in names)
    assert not any(n.startswith("secrets") for n in names)


def test_build_tarball_size_cap(tmp_path: Path):
    """Bigger than 50 MB compressed → SourceTooLargeError."""
    # 60 MB of incompressible (random) data
    import os
    big = tmp_path / "huge.bin"
    big.write_bytes(os.urandom(60 * 1024 * 1024))

    with pytest.raises(SourceTooLargeError, match="50 MB"):
        build_tarball(tmp_path)
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `build_tarball`**

Append to `bindu/runtime/source_packager.py`:
```python
import gzip
import io
import tarfile

MAX_TARBALL_BYTES = 50 * 1024 * 1024  # 50 MB compressed


class SourceTooLargeError(Exception):
    """Raised when the project source exceeds the tarball size cap."""


def build_tarball(root: Path) -> bytes:
    """Tar+gzip everything under `root` that survives `should_include`.

    Returns the gzipped tar as bytes. Files are stored with paths relative
    to `root` (e.g. `agent.py`, `lib/util.py`).

    Raises:
        SourceTooLargeError: when compressed size > MAX_TARBALL_BYTES.
    """
    spec = IgnoreSpec.load(root)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in sorted(root.rglob("*")):
            if not should_include(path, root, spec):
                continue
            if path.is_dir():
                continue  # tar will create dirs as part of files
            arcname = str(path.relative_to(root)).replace("\\", "/")
            tar.add(path, arcname=arcname, recursive=False)
    blob = buf.getvalue()
    if len(blob) > MAX_TARBALL_BYTES:
        raise SourceTooLargeError(
            f"source tarball is {len(blob) / 1024 / 1024:.1f} MB; "
            f"limit is 50 MB. Add large paths to .binduignore."
        )
    return blob
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_source_packager.py -v
```
Expected: 19 passed.

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/source_packager.py tests/unit/runtime/test_source_packager.py
git commit -m "feat(runtime): tarball builder with size cap"
```

---

## Task 7: `InProcessRuntimeProvider`

**Goal:** the no-op default — runs the agent in the host process. This lets `bindufy()` always go through `get_provider(...).deploy(...)`, even when the user didn't configure a runtime.

**Files:**
- Create: `bindu/runtime/in_process.py`
- Test: `tests/unit/runtime/test_in_process.py`
- Modify: `bindu/runtime/__init__.py` — register the provider on import

- [ ] **Step 1: Write tests**

`tests/unit/runtime/test_in_process.py`:
```python
"""Tests for InProcessRuntimeProvider — the default no-op runtime."""
import pytest
from bindu.runtime import RuntimeConfig, get_provider
from bindu.runtime.in_process import InProcessRuntimeProvider


@pytest.mark.asyncio
async def test_deploy_returns_handle():
    p = InProcessRuntimeProvider()
    cfg = RuntimeConfig.from_dict(None)
    h = await p.deploy("my-agent", source_dir=None, config=cfg, env=None)
    assert h.name == "my-agent"
    assert h.provider == "in-process"
    assert h.url.startswith("http://")


@pytest.mark.asyncio
async def test_health_always_true():
    p = InProcessRuntimeProvider()
    cfg = RuntimeConfig.from_dict(None)
    h = await p.deploy("a", None, cfg, None)
    assert await p.health(h) is True


@pytest.mark.asyncio
async def test_on_exit_is_noop():
    p = InProcessRuntimeProvider()
    cfg = RuntimeConfig.from_dict(None)
    h = await p.deploy("a", None, cfg, None)
    # All three modes are no-ops; just verify they don't raise.
    await p.on_exit(h, "suspend")
    await p.on_exit(h, "destroy")
    await p.on_exit(h, "detach")


def test_provider_registered_on_import():
    p = get_provider("in-process")
    assert isinstance(p, InProcessRuntimeProvider)
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `InProcessRuntimeProvider`**

`bindu/runtime/in_process.py`:
```python
"""InProcessRuntimeProvider — the default; runs the agent in the host process.

This provider is a deliberate no-op: it produces a `RuntimeHandle` pointing
at the host-local URL and lets the existing in-process server (started
elsewhere by `bindufy()`) do the actual work. Its purpose is to make
"default behavior" inspectable through the same abstraction as boxd.
"""
from __future__ import annotations
from pathlib import Path
from typing import AsyncIterator, Literal

from bindu.runtime.base import RuntimeHandle, RuntimeProvider, register_provider
from bindu.runtime.config import RuntimeConfig


class InProcessRuntimeProvider(RuntimeProvider):
    async def deploy(
        self,
        agent_name: str,
        source_dir: Path | None,
        config: RuntimeConfig,
        env: dict[str, str] | None = None,
    ) -> RuntimeHandle:
        return RuntimeHandle(
            name=agent_name,
            url="http://localhost:3773",
            provider="in-process",
            metadata={},
        )

    async def health(self, handle: RuntimeHandle) -> bool:
        return True

    async def stream_logs(
        self, handle: RuntimeHandle, follow: bool = True
    ) -> AsyncIterator[bytes]:
        # No log stream — the host process logs natively.
        return
        yield  # makes this an async generator (unreachable)

    async def on_exit(
        self,
        handle: RuntimeHandle,
        mode: Literal["suspend", "destroy", "detach"],
    ) -> None:
        # In-process lifecycle is owned by the existing server; nothing to do here.
        return None


register_provider("in-process", InProcessRuntimeProvider)
```

Update `bindu/runtime/__init__.py` to import it (so registration happens):
```python
"""Runtime provider abstraction for bindu agents."""
from bindu.runtime.base import (
    RuntimeHandle,
    RuntimeProvider,
    UnknownProviderError,
    register_provider,
    get_provider,
)
from bindu.runtime.config import RuntimeConfig, RuntimeConfigError

# Register built-in providers on import.
from bindu.runtime import in_process as _in_process  # noqa: F401

__all__ = [
    "RuntimeHandle",
    "RuntimeProvider",
    "UnknownProviderError",
    "register_provider",
    "get_provider",
    "RuntimeConfig",
    "RuntimeConfigError",
]
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/ -v
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/in_process.py bindu/runtime/__init__.py tests/unit/runtime/test_in_process.py
git commit -m "feat(runtime): InProcessRuntimeProvider as default no-op"
```

---

## Task 8: BoxdRuntimeProvider — scaffold + VM resolve

**Goal:** boilerplate of the boxd provider plus the "is there already a VM with this name? reuse or create" step.

**Files:**
- Create: `bindu/runtime/boxd_provider.py`
- Test: `tests/unit/runtime/test_boxd_provider.py`
- Modify: `tests/unit/runtime/conftest.py` — add `mock_boxd` fixture
- Modify: `bindu/runtime/__init__.py` — import to trigger registration
- Modify: `pyproject.toml` — add `boxd` extra

- [ ] **Step 1: Add `mock_boxd` fixture**

Update `tests/unit/runtime/conftest.py`:
```python
"""Fixtures for runtime provider unit tests."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock
import pytest


class _FakeBox:
    """Stand-in for boxd.aio.Box used by tests."""
    def __init__(self, name: str = "agent", vm_id: str = "vm-1"):
        self.id = vm_id
        self.name = name
        self.image = "ubuntu:latest"
        self.public_ip = "1.2.3.4"
        self.status = "running"
        self.url = f"https://{name}.boxd.sh"
        self.boot_time_ms = 2000
        # All async methods that the provider may call:
        self.exec = AsyncMock()
        self.write_file = AsyncMock()
        self.read_file = AsyncMock(return_value=b"")
        self.destroy = AsyncMock()
        self.suspend = AsyncMock()
        self.resume = AsyncMock()
        self.stream_logs = MagicMock()  # returns async iterator


class _FakeBoxService:
    def __init__(self):
        self.create = AsyncMock()
        self.get = AsyncMock()
        self.list = AsyncMock(return_value=[])
        self.fork = AsyncMock()


class _FakeCompute:
    """Stand-in for boxd.aio.Compute."""
    def __init__(self):
        self.box = _FakeBoxService()
        self.template = MagicMock()
        self.disk = MagicMock()
        self.domain = MagicMock()
        self.network = MagicMock()
        self.token = MagicMock()
        self.close = AsyncMock()
        self.whoami = AsyncMock()
        self.config = AsyncMock()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        await self.close()


@pytest.fixture
def fake_box():
    """A fresh _FakeBox per test."""
    return _FakeBox()


@pytest.fixture
def fake_compute(fake_box):
    """A fresh _FakeCompute per test, wired so .box.create returns fake_box."""
    c = _FakeCompute()
    c.box.create.return_value = fake_box
    c.box.get.return_value = fake_box
    return c


@pytest.fixture
def mock_boxd(monkeypatch, fake_compute):
    """Patch `boxd.aio.Compute` to return `fake_compute`. Returns the fake."""
    import bindu.runtime.boxd_provider as bp
    monkeypatch.setattr(bp, "_make_compute", lambda **kw: fake_compute)
    return fake_compute
```

- [ ] **Step 2: Write tests**

`tests/unit/runtime/test_boxd_provider.py`:
```python
"""Tests for BoxdRuntimeProvider — all with the boxd SDK mocked."""
from pathlib import Path
import pytest
from bindu.runtime import RuntimeConfig
from bindu.runtime.boxd_provider import BoxdRuntimeProvider


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
    """vcpu, memory, disk, image, auto_suspend should land in the create call."""
    from boxd.errors import NotFoundError
    mock_boxd.box.get.side_effect = NotFoundError("nope")
    p = BoxdRuntimeProvider()

    cfg = RuntimeConfig.from_dict({
        "provider": "boxd",
        "image": "ghcr.io/me/agent:v1",
        "vcpu": 4,
        "memory": "8G",
        "disk": "40G",
        "auto_suspend": 30,
    })
    await p._resolve_vm(mock_boxd, "my-agent", cfg)

    call = mock_boxd.box.create.await_args
    # `name` is a keyword arg per boxes.py signature
    assert call.kwargs["name"] == "my-agent" or call.args[0] == "my-agent"
    box_config = call.kwargs.get("config")
    assert box_config is not None
    assert box_config.vcpu == 4
    assert box_config.memory == "8G"
    assert box_config.disk == "40G"
    # Image goes through `image` kwarg, not BoxConfig (per boxd SDK)
    assert call.kwargs.get("image") == "ghcr.io/me/agent:v1"
```

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Implement scaffold + `_resolve_vm`**

`bindu/runtime/boxd_provider.py`:
```python
"""BoxdRuntimeProvider — runs a bindu agent inside a boxd microVM.

Two modes:
- A2 (default): ship local source via tar+gzip, install deps, exec `bindu serve`.
- A1: provide an `image` field; boxd creates the VM from that image, no source ship.

The host's role ends after the agent is healthy. A2A clients then talk
directly to the VM's public URL.
"""
from __future__ import annotations
import os
from pathlib import Path
from typing import AsyncIterator, Literal, Any

from bindu.runtime.base import RuntimeHandle, RuntimeProvider, register_provider
from bindu.runtime.config import RuntimeConfig


def _make_compute(**kwargs: Any):
    """Indirection so tests can monkey-patch boxd.aio.Compute."""
    from boxd.aio import Compute
    return Compute(**kwargs)


class BoxdRuntimeProvider(RuntimeProvider):
    async def _resolve_vm(self, compute: Any, name: str, config: RuntimeConfig):
        """Get or create the VM for this agent."""
        from boxd import BoxConfig
        from boxd.errors import NotFoundError

        try:
            return await compute.box.get(name)
        except NotFoundError:
            pass

        box_config = BoxConfig(
            vcpu=config.vcpu,
            memory=config.memory,
            disk=config.disk,
        )
        create_kwargs: dict[str, Any] = {
            "name": name,
            "config": box_config,
        }
        if config.image:
            create_kwargs["image"] = config.image
        return await compute.box.create(**create_kwargs)

    async def deploy(
        self,
        agent_name: str,
        source_dir: Path | None,
        config: RuntimeConfig,
        env: dict[str, str] | None = None,
    ) -> RuntimeHandle:
        raise NotImplementedError("Task 9+: full deploy")

    async def health(self, handle: RuntimeHandle) -> bool:
        raise NotImplementedError("Task 11")

    async def stream_logs(
        self, handle: RuntimeHandle, follow: bool = True
    ) -> AsyncIterator[bytes]:
        raise NotImplementedError("Task 12")
        yield  # unreachable

    async def on_exit(
        self,
        handle: RuntimeHandle,
        mode: Literal["suspend", "destroy", "detach"],
    ) -> None:
        raise NotImplementedError("Task 13")


register_provider("boxd", BoxdRuntimeProvider)
```

Update `bindu/runtime/__init__.py`:
```python
# (existing imports) ...
from bindu.runtime import in_process as _in_process  # noqa: F401
from bindu.runtime import boxd_provider as _boxd_provider  # noqa: F401
```

Update `pyproject.toml` `[project.optional-dependencies]`:
```toml
[project.optional-dependencies]
runtime-boxd = [
    "boxd>=0.1.0",
]
```

- [ ] **Step 5: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_boxd_provider.py -v
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add bindu/runtime/boxd_provider.py bindu/runtime/__init__.py \
       tests/unit/runtime/conftest.py tests/unit/runtime/test_boxd_provider.py \
       pyproject.toml
git commit -m "feat(runtime): BoxdRuntimeProvider scaffold + VM resolve"
```

---

## Task 9: BoxdRuntimeProvider — A2 source ship + deps install

**Goal:** the source-mount path. Given a `source_dir`, tar+ship+install in the VM.

**Files:**
- Modify: `bindu/runtime/boxd_provider.py` — implement `_ship_source`, `_install_deps`
- Modify: `tests/unit/runtime/test_boxd_provider.py` — add tests

- [ ] **Step 1: Add tests**

Append to `tests/unit/runtime/test_boxd_provider.py`:
```python
@pytest.mark.asyncio
async def test_ship_source_writes_and_extracts(mock_boxd, fake_box, tmp_path):
    (tmp_path / "agent.py").write_text("# hi\n")
    p = BoxdRuntimeProvider()

    await p._ship_source(fake_box, tmp_path)

    fake_box.write_file.assert_awaited_once()
    args = fake_box.write_file.await_args
    payload, dest = args.args[0], args.args[1]
    assert isinstance(payload, bytes)
    assert dest == "/tmp/source.tar.gz"

    # Then tar extract is exec'd
    fake_box.exec.assert_awaited_with(
        "tar", "xzf", "/tmp/source.tar.gz", "-C", "/app"
    )


@pytest.mark.asyncio
async def test_install_deps_with_pyproject(mock_boxd, fake_box):
    """If pyproject.toml exists in /app, run `pip install -e .`."""
    fake_box.exec.return_value = _ok_exec_result()
    p = BoxdRuntimeProvider()

    await p._install_deps(fake_box, has_pyproject=True, has_requirements=False)

    # The provider always installs bindu first
    bindu_call = next(
        c for c in fake_box.exec.await_args_list
        if "bindu" in str(c.args) and "install" in str(c.args)
    )
    assert bindu_call is not None
    # Then pip install -e .
    pip_e_call = next(
        c for c in fake_box.exec.await_args_list
        if c.args[:4] == ("pip", "install", "-e", ".")
    )
    assert pip_e_call is not None


@pytest.mark.asyncio
async def test_install_deps_with_requirements(mock_boxd, fake_box):
    fake_box.exec.return_value = _ok_exec_result()
    p = BoxdRuntimeProvider()

    await p._install_deps(fake_box, has_pyproject=False, has_requirements=True)

    req_call = next(
        c for c in fake_box.exec.await_args_list
        if c.args == ("pip", "install", "-r", "/app/requirements.txt")
    )
    assert req_call is not None


def _ok_exec_result():
    """Stub ExecResult with exit_code=0."""
    from unittest.mock import MagicMock
    r = MagicMock()
    r.exit_code = 0
    r.success = True
    r.stdout = ""
    r.stderr = ""
    return r
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `_ship_source` and `_install_deps`**

In `bindu/runtime/boxd_provider.py`, add:
```python
from bindu.runtime.source_packager import build_tarball


class BoxdRuntimeProvider(RuntimeProvider):
    # ... (existing _resolve_vm) ...

    async def _ship_source(self, box: Any, source_dir: Path) -> None:
        """Tar+gzip source_dir, upload, extract to /app in the VM."""
        blob = build_tarball(source_dir)
        await box.write_file(blob, "/tmp/source.tar.gz")
        # mkdir -p /app first
        await box.exec("mkdir", "-p", "/app")
        result = await box.exec(
            "tar", "xzf", "/tmp/source.tar.gz", "-C", "/app"
        )
        if getattr(result, "exit_code", 0) != 0:
            raise RuntimeError(
                f"failed to extract source in VM: {result.stderr}"
            )

    async def _install_deps(
        self,
        box: Any,
        has_pyproject: bool,
        has_requirements: bool,
        bindu_version: str | None = None,
    ) -> None:
        """Install bindu + the user's deps inside /app."""
        bindu_pkg = f"bindu=={bindu_version}" if bindu_version else "bindu"
        for cmd in self._build_install_commands(
            bindu_pkg, has_pyproject, has_requirements
        ):
            result = await box.exec(*cmd)
            if getattr(result, "exit_code", 0) != 0:
                raise RuntimeError(
                    f"command {cmd} failed in VM: {result.stderr}"
                )

    @staticmethod
    def _build_install_commands(
        bindu_pkg: str, has_pyproject: bool, has_requirements: bool
    ) -> list[tuple[str, ...]]:
        cmds: list[tuple[str, ...]] = [("pip", "install", bindu_pkg)]
        if has_requirements:
            cmds.append(("pip", "install", "-r", "/app/requirements.txt"))
        if has_pyproject:
            cmds.append(("pip", "install", "-e", "."))
        return cmds
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_boxd_provider.py -v
```

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/boxd_provider.py tests/unit/runtime/test_boxd_provider.py
git commit -m "feat(runtime): A2 source ship + deps install"
```

---

## Task 10: BoxdRuntimeProvider — agent start + health check

**Goal:** exec `bindu serve --script` inside the VM, then poll `https://{name}.boxd.sh/health` until healthy.

**Files:**
- Modify: `bindu/runtime/boxd_provider.py` — `_start_agent`, `_wait_healthy`
- Modify: `tests/unit/runtime/test_boxd_provider.py` — tests

- [ ] **Step 1: Add tests**

Append:
```python
import httpx
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_start_agent_execs_bindu_serve(mock_boxd, fake_box):
    p = BoxdRuntimeProvider()
    fake_box.exec.return_value = _ok_exec_result()

    await p._start_agent(fake_box, script="my_agent.py", env={"FOO": "bar"})

    fake_box.exec.assert_awaited()
    cmd_call = fake_box.exec.await_args
    cmd_args = cmd_call.args
    assert "bindu" in cmd_args
    assert "serve" in cmd_args
    assert "--script" in cmd_args
    assert "/app/my_agent.py" in cmd_args
    # env is passed
    assert cmd_call.kwargs.get("env") == {"FOO": "bar"}


@pytest.mark.asyncio
async def test_wait_healthy_polls_until_200():
    """First two responses 503, third is 200 → success."""
    p = BoxdRuntimeProvider()
    responses = [
        httpx.Response(503),
        httpx.Response(503),
        httpx.Response(200),
    ]
    transport = httpx.MockTransport(lambda req: responses.pop(0))

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value = httpx.AsyncClient(
            transport=transport
        )
        await p._wait_healthy("https://my-agent.boxd.sh", timeout=10.0)


@pytest.mark.asyncio
async def test_wait_healthy_times_out():
    p = BoxdRuntimeProvider()
    transport = httpx.MockTransport(lambda req: httpx.Response(503))

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value = httpx.AsyncClient(
            transport=transport
        )
        with pytest.raises(TimeoutError, match="health"):
            await p._wait_healthy("https://my-agent.boxd.sh", timeout=0.5)
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

Add to `bindu/runtime/boxd_provider.py`:
```python
import asyncio
import httpx


class BoxdRuntimeProvider(RuntimeProvider):
    # ...

    async def _start_agent(
        self,
        box: Any,
        script: str,
        env: dict[str, str] | None = None,
        public_url: str | None = None,
    ) -> None:
        """Exec `bindu serve --script /app/<script>` inside the VM."""
        merged_env = dict(env or {})
        if public_url:
            merged_env["BINDU_PUBLIC_URL"] = public_url

        # nohup + & via sh -c so the exec call returns once the agent is forked
        cmd_str = (
            f"nohup bindu serve --script /app/{script} "
            f"> /var/log/bindu-agent.log 2>&1 &"
        )
        result = await box.exec(
            "sh", "-c", cmd_str,
            env=merged_env,
        )
        if getattr(result, "exit_code", 0) != 0:
            raise RuntimeError(f"failed to start agent: {result.stderr}")

    async def _wait_healthy(self, url: str, timeout: float = 60.0) -> None:
        """Poll {url}/health until 200 or timeout."""
        deadline = asyncio.get_event_loop().time() + timeout
        async with httpx.AsyncClient(timeout=5.0) as client:
            while asyncio.get_event_loop().time() < deadline:
                try:
                    resp = await client.get(f"{url}/health")
                    if resp.status_code == 200:
                        return
                except (httpx.HTTPError, httpx.TimeoutException):
                    pass
                await asyncio.sleep(1.0)
        raise TimeoutError(
            f"agent at {url} did not become healthy within {timeout}s"
        )
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/boxd_provider.py tests/unit/runtime/test_boxd_provider.py
git commit -m "feat(runtime): agent start + health polling"
```

---

## Task 11: BoxdRuntimeProvider — full `deploy()` integration

**Goal:** stitch `_resolve_vm` + `_ship_source` + `_install_deps` + `_start_agent` + `_wait_healthy` into the public `deploy()`. Distinguish A1 (image set) from A2.

**Files:**
- Modify: `bindu/runtime/boxd_provider.py`
- Modify: `tests/unit/runtime/test_boxd_provider.py`

- [ ] **Step 1: Add tests**

```python
@pytest.mark.asyncio
async def test_deploy_a2_full_flow(mock_boxd, fake_box, tmp_path, monkeypatch):
    """A2 deploy: source ship + install + start + healthy."""
    (tmp_path / "agent.py").write_text("from bindu.penguin.bindufy import bindufy\n")
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")
    fake_box.exec.return_value = _ok_exec_result()

    async def fake_wait(self, url, timeout=60.0):
        return None

    monkeypatch.setattr(BoxdRuntimeProvider, "_wait_healthy", fake_wait)

    p = BoxdRuntimeProvider()
    cfg = RuntimeConfig.from_dict({"provider": "boxd"})

    handle = await p.deploy(
        agent_name="my-agent",
        source_dir=tmp_path,
        config=cfg,
        env={"OPENAI_API_KEY": "sk-test"},
    )

    assert handle.name == "my-agent"
    assert handle.url == "https://my-agent.boxd.sh"
    assert handle.provider == "boxd"
    assert handle.metadata.get("vm_id") == "vm-1"

    # Verify ship + install + start happened
    fake_box.write_file.assert_awaited_once()
    pip_calls = [
        c for c in fake_box.exec.await_args_list
        if c.args and c.args[0] == "pip"
    ]
    assert pip_calls, "pip install should have been called"
    serve_calls = [
        c for c in fake_box.exec.await_args_list
        if c.args and c.args[0] == "sh"
        and "bindu serve" in c.args[2]
    ]
    assert serve_calls, "bindu serve should have been called"


@pytest.mark.asyncio
async def test_deploy_a1_skips_source(mock_boxd, fake_box, monkeypatch):
    """A1 deploy: no source_dir use; image-based VM."""
    from boxd.errors import NotFoundError
    mock_boxd.box.get.side_effect = NotFoundError("nope")
    fake_box.exec.return_value = _ok_exec_result()

    async def fake_wait(self, url, timeout=60.0):
        return None

    monkeypatch.setattr(BoxdRuntimeProvider, "_wait_healthy", fake_wait)

    p = BoxdRuntimeProvider()
    cfg = RuntimeConfig.from_dict({
        "provider": "boxd",
        "image": "ghcr.io/me/agent:v1",
    })

    handle = await p.deploy(
        agent_name="my-agent",
        source_dir=None,
        config=cfg,
        env=None,
    )

    assert handle.url == "https://my-agent.boxd.sh"
    # No source ship
    fake_box.write_file.assert_not_awaited()
    # No pip install
    pip_calls = [
        c for c in fake_box.exec.await_args_list
        if c.args and c.args[0] == "pip"
    ]
    assert not pip_calls
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `deploy`**

```python
class BoxdRuntimeProvider(RuntimeProvider):
    # ...

    async def deploy(
        self,
        agent_name: str,
        source_dir: Path | None,
        config: RuntimeConfig,
        env: dict[str, str] | None = None,
    ) -> RuntimeHandle:
        api_key = os.environ.get("BOXD_API_KEY")
        if not api_key and not os.environ.get("BOXD_TOKEN"):
            raise RuntimeError(
                "BOXD_API_KEY or BOXD_TOKEN must be set in the host environment"
            )

        async with _make_compute() as compute:
            box = await self._resolve_vm(compute, agent_name, config)
            public_url = box.url or f"https://{agent_name}.boxd.sh"

            if config.image is None:
                # A2: source-mount mode
                if source_dir is None:
                    raise RuntimeError(
                        "source_dir is required when config.image is not set"
                    )
                await self._ship_source(box, source_dir)
                has_pyproject = (source_dir / "pyproject.toml").exists()
                has_requirements = (source_dir / "requirements.txt").exists()
                await self._install_deps(
                    box, has_pyproject, has_requirements, config.bindu_version
                )
                # Find the agent script (the one that called bindufy)
                script = self._detect_script_name(source_dir)
                merged_env = {**config.env, **(env or {})}
                await self._start_agent(
                    box, script=script, env=merged_env, public_url=public_url
                )
            # else: A1 — image's CMD already started the agent

            await self._wait_healthy(public_url, timeout=60.0)

            return RuntimeHandle(
                name=agent_name,
                url=public_url,
                provider="boxd",
                metadata={
                    "vm_id": box.id,
                    "public_ip": box.public_ip,
                },
            )

    @staticmethod
    def _detect_script_name(source_dir: Path) -> str:
        """Best-effort: prefer a .py file with a bindufy() call at the top level.
        For now, just take the first such match in source_dir.
        """
        candidates = sorted(source_dir.glob("*.py"))
        for c in candidates:
            try:
                if "bindufy(" in c.read_text(errors="ignore"):
                    return c.name
            except OSError:
                continue
        if candidates:
            return candidates[0].name
        raise RuntimeError(
            f"no .py file found in {source_dir} to use as agent entry point"
        )
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_boxd_provider.py -v
```

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/boxd_provider.py tests/unit/runtime/test_boxd_provider.py
git commit -m "feat(runtime): full BoxdRuntimeProvider.deploy (A2+A1)"
```

---

## Task 12: BoxdRuntimeProvider — health, stream_logs, on_exit

**Files:**
- Modify: `bindu/runtime/boxd_provider.py`
- Modify: `tests/unit/runtime/test_boxd_provider.py`

- [ ] **Step 1: Add tests**

```python
@pytest.mark.asyncio
async def test_health_returns_true_when_200(mock_boxd):
    p = BoxdRuntimeProvider()
    transport = httpx.MockTransport(lambda req: httpx.Response(200))
    with patch("httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value = httpx.AsyncClient(transport=transport)
        h = RuntimeHandle("a", "https://a.boxd.sh", "boxd", {})
        assert await p.health(h) is True


@pytest.mark.asyncio
async def test_health_returns_false_when_unreachable(mock_boxd):
    p = BoxdRuntimeProvider()
    transport = httpx.MockTransport(
        lambda req: (_ for _ in ()).throw(httpx.ConnectError("boom"))
    )
    with patch("httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value = httpx.AsyncClient(transport=transport)
        h = RuntimeHandle("a", "https://a.boxd.sh", "boxd", {})
        assert await p.health(h) is False


@pytest.mark.asyncio
async def test_on_exit_destroy(mock_boxd, fake_box):
    mock_boxd.box.get.return_value = fake_box
    p = BoxdRuntimeProvider()
    h = RuntimeHandle("my-agent", "https://my-agent.boxd.sh", "boxd",
                      {"vm_id": "vm-1"})
    await p.on_exit(h, "destroy")
    fake_box.destroy.assert_awaited_once()


@pytest.mark.asyncio
async def test_on_exit_suspend(mock_boxd, fake_box):
    mock_boxd.box.get.return_value = fake_box
    p = BoxdRuntimeProvider()
    h = RuntimeHandle("my-agent", "https://my-agent.boxd.sh", "boxd", {})
    await p.on_exit(h, "suspend")
    # We rely on boxd auto_suspend; just verify we did NOT destroy
    fake_box.destroy.assert_not_awaited()


@pytest.mark.asyncio
async def test_on_exit_detach_is_noop(mock_boxd, fake_box):
    p = BoxdRuntimeProvider()
    h = RuntimeHandle("my-agent", "https://my-agent.boxd.sh", "boxd", {})
    await p.on_exit(h, "detach")
    fake_box.destroy.assert_not_awaited()
    fake_box.suspend.assert_not_awaited()
```

For `stream_logs`, the test relies on the `box.stream_logs` returning an async iterator. Add:
```python
@pytest.mark.asyncio
async def test_stream_logs_yields_chunks(mock_boxd, fake_box):
    """stream_logs(follow=True) should pass-through box.stream_logs output."""
    chunks = [b"hello\n", b"world\n"]

    async def fake_gen(follow=False):
        for c in chunks:
            yield c

    fake_box.stream_logs = fake_gen
    mock_boxd.box.get.return_value = fake_box

    p = BoxdRuntimeProvider()
    h = RuntimeHandle("my-agent", "https://my-agent.boxd.sh", "boxd", {})
    out = []
    async for chunk in p.stream_logs(h, follow=True):
        out.append(chunk)
    assert out == chunks
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```python
class BoxdRuntimeProvider(RuntimeProvider):
    # ...

    async def health(self, handle: RuntimeHandle) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{handle.url}/health")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False

    async def stream_logs(
        self, handle: RuntimeHandle, follow: bool = True
    ) -> AsyncIterator[bytes]:
        async with _make_compute() as compute:
            box = await compute.box.get(handle.name)
            async for chunk in box.stream_logs(follow=follow):
                yield chunk

    async def on_exit(
        self,
        handle: RuntimeHandle,
        mode: Literal["suspend", "destroy", "detach"],
    ) -> None:
        if mode == "detach":
            return
        async with _make_compute() as compute:
            try:
                box = await compute.box.get(handle.name)
            except Exception:
                return
            if mode == "destroy":
                await box.destroy()
            elif mode == "suspend":
                # boxd auto_suspend is configured at create time; nothing to do here.
                # We could explicitly suspend, but auto_suspend is the canonical behavior.
                return
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add bindu/runtime/boxd_provider.py tests/unit/runtime/test_boxd_provider.py
git commit -m "feat(runtime): health, stream_logs, on_exit (suspend/destroy/detach)"
```

---

## Task 13: CLI — `bindu serve --script`

**Goal:** the in-VM entry point. `bindu serve --script /app/agent.py` imports the user's script (which calls `bindufy()` internally) and runs the resulting in-process server. This is what the BoxdRuntimeProvider execs inside the VM.

**Files:**
- Modify: `bindu/cli/__init__.py` — extend `_handle_serve` to accept `--script`
- Test: `tests/unit/runtime/test_cli_serve_script.py`

- [ ] **Step 1: Write test**

`tests/unit/runtime/test_cli_serve_script.py`:
```python
"""Test `bindu serve --script <path>`."""
import sys
from pathlib import Path
import subprocess


def test_serve_script_imports_user_module(tmp_path: Path):
    """`bindu serve --script foo.py` should execute foo.py in __main__ context."""
    script = tmp_path / "foo.py"
    script.write_text(
        "import sys\n"
        "print('SCRIPT_RAN', file=sys.stderr)\n"
        "sys.exit(0)\n"
    )
    # Use the running interpreter to invoke `bindu` as a module to avoid
    # needing the bindu console_script entrypoint to be on PATH.
    result = subprocess.run(
        [sys.executable, "-m", "bindu.cli", "serve", "--script", str(script)],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert "SCRIPT_RAN" in result.stderr
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Modify `_handle_serve`**

Update `bindu/cli/__init__.py`:
```python
def _handle_serve(args: argparse.Namespace) -> None:
    """Handle the `bindu serve` command.

    Modes:
      --script <path>:  execute a user agent script (the script calls bindufy()).
      --grpc:           start the gRPC core for SDK registration.
    """
    if args.script:
        _run_user_script(args.script)
        return

    if not args.grpc:
        print("Error: --grpc or --script required for `bindu serve`")
        sys.exit(1)

    # ... existing gRPC code ...


def _run_user_script(path: str) -> None:
    """Execute the user's agent script in __main__ context."""
    import runpy
    script_path = os.path.abspath(path)
    sys.path.insert(0, os.path.dirname(script_path))
    runpy.run_path(script_path, run_name="__main__")


def main() -> None:
    parser = argparse.ArgumentParser(prog="bindu", description="Bindu Framework CLI")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    serve_parser = subparsers.add_parser("serve", help="Start the Bindu core server")
    serve_parser.add_argument(
        "--grpc", action="store_true",
        help="Enable gRPC server for SDK registration",
    )
    serve_parser.add_argument(
        "--grpc-port", type=int, default=3774,
        help="gRPC server port (default: 3774)",
    )
    serve_parser.add_argument(
        "--script", type=str, default=None,
        help="Path to a user agent script that calls bindufy()",
    )

    args = parser.parse_args()
    if args.command == "serve":
        _handle_serve(args)
    else:
        parser.print_help()
        sys.exit(1)
```

Add `import os` at top.

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_cli_serve_script.py -v
```

- [ ] **Step 5: Commit**

```bash
git add bindu/cli/__init__.py tests/unit/runtime/test_cli_serve_script.py
git commit -m "feat(cli): bindu serve --script <path>"
```

---

## Task 14: `bindufy()` integration

**Goal:** when `runtime` is in the config, dispatch to the runtime provider instead of starting the local server. When `runtime` is missing or `provider == "in-process"`, behave exactly as today.

**Files:**
- Modify: `bindu/penguin/bindufy.py` — add runtime detection + dispatch
- Test: `tests/unit/runtime/test_bindufy_integration.py`

- [ ] **Step 1: Read current bindufy.py to understand call shape**

```bash
grep -n "def bindufy\|def _start_server\|def _build_app\|launch=" bindu/penguin/bindufy.py | head -10
```

This task assumes `bindufy(config, handler, ...)` has a clear "start the server" point we can branch around. Verify before coding.

- [ ] **Step 2: Write test**

`tests/unit/runtime/test_bindufy_integration.py`:
```python
"""Tests for bindufy() runtime dispatch."""
from unittest.mock import patch, AsyncMock, MagicMock
import pytest


@pytest.mark.asyncio
async def test_bindufy_in_process_default(monkeypatch):
    """Without runtime= in config, bindufy uses the in-process path (today's behavior)."""
    from bindu.penguin.bindufy import bindufy
    started = {"ok": False}

    def fake_start_server(*a, **kw):
        started["ok"] = True

    monkeypatch.setattr(
        "bindu.penguin.bindufy._start_in_process_server", fake_start_server
    )

    def handler(messages):
        return "hi"

    config = {
        "name": "test-agent",
        "deployment": {"url": "http://localhost:3773", "expose": False},
    }
    bindufy(config, handler)
    assert started["ok"]


@pytest.mark.asyncio
async def test_bindufy_with_runtime_dispatches_to_provider(monkeypatch):
    """runtime={"provider": "boxd"} → call provider.deploy, not local server."""
    from bindu.runtime.base import RuntimeHandle
    fake_provider = MagicMock()
    fake_provider.deploy = AsyncMock(return_value=RuntimeHandle(
        "test-agent", "https://test-agent.boxd.sh", "boxd", {}
    ))
    fake_provider.stream_logs = MagicMock()
    fake_provider.on_exit = AsyncMock()

    async def fake_stream(*a, **kw):
        return
        yield  # noqa

    fake_provider.stream_logs.return_value = fake_stream()

    monkeypatch.setattr(
        "bindu.runtime.get_provider", lambda name: fake_provider
    )
    # Don't actually block — patch the supervise loop
    monkeypatch.setattr(
        "bindu.penguin.bindufy._supervise", AsyncMock()
    )

    from bindu.penguin.bindufy import bindufy

    def handler(messages):
        return "hi"

    config = {
        "name": "test-agent",
        "deployment": {"url": "http://localhost:3773"},
    }
    bindufy(config, handler, runtime={"provider": "boxd"})
    fake_provider.deploy.assert_awaited_once()
```

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Implement runtime dispatch in `bindufy.py`**

The exact location of the change depends on the current bindufy structure. The shape:

```python
# top of file
import asyncio
import inspect
import os
import signal
import sys
from pathlib import Path

from bindu.runtime import RuntimeConfig, get_provider
from bindu.runtime.source_packager import find_project_root


def bindufy(
    config: dict,
    handler: Callable,
    *,
    runtime: dict | None = None,
    launch: bool = False,
    **kwargs,
):
    """Existing docstring..."""
    runtime_config = RuntimeConfig.from_dict(runtime)

    if runtime_config.provider == "in-process":
        # Existing behavior
        return _start_in_process_server(config, handler, launch=launch, **kwargs)

    # Runtime mode: dispatch to the provider
    return _start_with_runtime(config, handler, runtime_config)


def _start_in_process_server(config, handler, *, launch=False, **kwargs):
    """The existing bindufy body, refactored into a function.
    (Move the existing in-process path here.)
    """
    # ... existing code ...


def _start_with_runtime(config: dict, handler, runtime_config: RuntimeConfig) -> None:
    """Deploy the agent via the configured runtime provider."""
    agent_name = config["name"]
    provider = get_provider(runtime_config.provider)

    # Find the user script that called bindufy
    caller_frame = sys._getframe(2)
    caller_path = Path(caller_frame.f_globals.get("__file__", "")).resolve()
    source_dir = find_project_root(caller_path) if caller_path.is_file() else None

    asyncio.run(_deploy_and_supervise(
        provider, agent_name, source_dir, runtime_config
    ))


async def _deploy_and_supervise(
    provider, agent_name, source_dir, runtime_config: RuntimeConfig
) -> None:
    """Deploy + stream logs + handle Ctrl-C."""
    handle = await provider.deploy(
        agent_name=agent_name,
        source_dir=source_dir,
        config=runtime_config,
        env=None,
    )
    print(f"\n✓ {agent_name} serving at {handle.url}\n")
    await _supervise(provider, handle, runtime_config)


async def _supervise(provider, handle, runtime_config: RuntimeConfig) -> None:
    """Stream logs to host stdout, block until SIGINT, then on_exit."""
    log_task = asyncio.create_task(_pipe_logs(provider, handle))

    stop = asyncio.Event()
    loop = asyncio.get_event_loop()

    def _on_sigint():
        stop.set()

    loop.add_signal_handler(signal.SIGINT, _on_sigint)
    loop.add_signal_handler(signal.SIGTERM, _on_sigint)

    try:
        await stop.wait()
    finally:
        log_task.cancel()
        try:
            await log_task
        except asyncio.CancelledError:
            pass
        await provider.on_exit(handle, runtime_config.on_exit)


async def _pipe_logs(provider, handle) -> None:
    """Pipe VM logs to host stdout, prefixed with [name]."""
    prefix = f"[{handle.name}] "
    try:
        async for chunk in provider.stream_logs(handle, follow=True):
            text = chunk.decode("utf-8", errors="replace")
            for line in text.splitlines():
                print(prefix + line)
    except Exception as e:
        print(f"{prefix}log stream ended: {e}")
```

- [ ] **Step 5: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_bindufy_integration.py -v
```

- [ ] **Step 6: Run the full bindu test suite to make sure nothing regressed**

```bash
pytest tests/unit -x -q
```
Expected: previous test count + new tests, all pass.

- [ ] **Step 7: Commit**

```bash
git add bindu/penguin/bindufy.py tests/unit/runtime/test_bindufy_integration.py
git commit -m "feat(bindufy): dispatch to runtime provider when configured"
```

---

## Task 15: Provider contract test suite

**Goal:** an abstract pytest class that any future provider must satisfy. Plug-in for future e2b/modal/fly.io providers without re-deriving correctness criteria.

**Files:**
- Create: `tests/unit/runtime/test_provider_contract.py`

- [ ] **Step 1: Write contract**

```python
"""Provider contract tests — every RuntimeProvider must satisfy these.

Subclass `ProviderContract` and override `make_provider()` and `make_config()`.
The fixtures handle the rest. Currently exercised by InProcessRuntimeProvider
(BoxdRuntimeProvider has its own deeper tests with mocked SDK).
"""
from __future__ import annotations
from abc import abstractmethod
from pathlib import Path
import pytest

from bindu.runtime import RuntimeConfig, RuntimeHandle, RuntimeProvider
from bindu.runtime.in_process import InProcessRuntimeProvider


class ProviderContract:
    """Abstract test class. Subclass and override `make_provider`/`make_config`."""

    @abstractmethod
    def make_provider(self) -> RuntimeProvider: ...

    @abstractmethod
    def make_config(self) -> RuntimeConfig: ...

    @pytest.mark.asyncio
    async def test_deploy_returns_handle(self):
        p = self.make_provider()
        h = await p.deploy("contract-test", None, self.make_config())
        assert isinstance(h, RuntimeHandle)
        assert h.name == "contract-test"
        assert h.url
        assert h.provider

    @pytest.mark.asyncio
    async def test_health_returns_bool(self):
        p = self.make_provider()
        h = await p.deploy("contract-test", None, self.make_config())
        result = await p.health(h)
        assert isinstance(result, bool)

    @pytest.mark.asyncio
    async def test_on_exit_accepts_all_modes(self):
        p = self.make_provider()
        h = await p.deploy("contract-test", None, self.make_config())
        # All modes must be valid (may be no-op for some providers)
        await p.on_exit(h, "detach")


class TestInProcessProviderContract(ProviderContract):
    def make_provider(self):
        return InProcessRuntimeProvider()

    def make_config(self):
        return RuntimeConfig.from_dict(None)
```

- [ ] **Step 2: Run, expect PASS**

```bash
pytest tests/unit/runtime/test_provider_contract.py -v
```

- [ ] **Step 3: Commit**

```bash
git add tests/unit/runtime/test_provider_contract.py
git commit -m "test(runtime): provider contract test suite"
```

---

## Task 16: CLI — `bindu shell <agent>` and `bindu logs <agent>`

**Goal:** dev-DX commands. `bindu shell my-agent` opens an interactive bash on the agent's VM via `box.exec("bash", interactive=True)`. `bindu logs my-agent` streams VM logs.

**Files:**
- Modify: `bindu/cli/__init__.py`
- Test: `tests/unit/runtime/test_cli_shell_logs.py`

- [ ] **Step 1: Write tests**

```python
"""Tests for `bindu shell <agent>` and `bindu logs <agent>`."""
import sys
from unittest.mock import patch, AsyncMock, MagicMock
import pytest


@pytest.mark.asyncio
async def test_logs_streams_to_stdout(capsys):
    """`bindu logs my-agent` should pipe VM logs to stdout."""
    from bindu.cli import _handle_logs

    fake_box = MagicMock()
    chunks = [b"hello\n", b"world\n"]

    async def fake_stream(follow=True):
        for c in chunks:
            yield c

    fake_box.stream_logs = fake_stream

    fake_compute = MagicMock()
    fake_compute.box.get = AsyncMock(return_value=fake_box)
    fake_compute.__aenter__ = AsyncMock(return_value=fake_compute)
    fake_compute.__aexit__ = AsyncMock()

    with patch("bindu.cli._make_compute", return_value=fake_compute):
        await _handle_logs("my-agent", follow=False)

    out = capsys.readouterr().out
    assert "hello" in out
    assert "world" in out
```

For `shell`, since it spawns an interactive process, just verify it constructs the correct boxd call. Skip the actual interactive testing — the unit test confirms the wiring; e2e confirms it works.

```python
@pytest.mark.asyncio
async def test_shell_calls_exec_bash():
    from bindu.cli import _handle_shell
    fake_box = MagicMock()
    fake_box.exec = AsyncMock()

    fake_compute = MagicMock()
    fake_compute.box.get = AsyncMock(return_value=fake_box)
    fake_compute.__aenter__ = AsyncMock(return_value=fake_compute)
    fake_compute.__aexit__ = AsyncMock()

    with patch("bindu.cli._make_compute", return_value=fake_compute):
        await _handle_shell("my-agent")

    fake_box.exec.assert_awaited_once()
    args = fake_box.exec.await_args
    assert "bash" in args.args
    assert args.kwargs.get("interactive") is True
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

Add to `bindu/cli/__init__.py`:
```python
def _make_compute(**kw):
    """Indirection so tests can patch."""
    from boxd.aio import Compute
    return Compute(**kw)


async def _handle_logs(agent_name: str, follow: bool = True) -> None:
    async with _make_compute() as compute:
        box = await compute.box.get(agent_name)
        async for chunk in box.stream_logs(follow=follow):
            sys.stdout.write(chunk.decode("utf-8", errors="replace"))
            sys.stdout.flush()


async def _handle_shell(agent_name: str) -> None:
    async with _make_compute() as compute:
        box = await compute.box.get(agent_name)
        # boxd's exec(interactive=True) attaches stdin/stdout to the user's terminal
        await box.exec("bash", interactive=True)
```

Wire up in `main()`:
```python
logs_parser = subparsers.add_parser("logs", help="Stream agent logs from its VM")
logs_parser.add_argument("agent", type=str, help="Agent name")
logs_parser.add_argument("--no-follow", action="store_true",
                         help="Print snapshot instead of following")

shell_parser = subparsers.add_parser("shell", help="Open a shell on the agent's VM")
shell_parser.add_argument("agent", type=str, help="Agent name")

# at end of main():
elif args.command == "logs":
    asyncio.run(_handle_logs(args.agent, follow=not args.no_follow))
elif args.command == "shell":
    asyncio.run(_handle_shell(args.agent))
```

Add `import asyncio` at top.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add bindu/cli/__init__.py tests/unit/runtime/test_cli_shell_logs.py
git commit -m "feat(cli): bindu shell + bindu logs subcommands"
```

---

## Task 17: Documentation

**Files:**
- Create: `docs/runtime/README.md`
- Create: `docs/runtime/boxd.md`
- Create: `docs/runtime/custom-image.md`

- [ ] **Step 1: Write `docs/runtime/README.md`** (overview, when to use, hello-world)

Should include:
- What is the runtime provider abstraction?
- 5-line quickstart with `runtime={"provider": "boxd"}`
- Pointer to boxd.md and custom-image.md
- Known limitations: no streaming responses across the boundary yet, no live source-watch

- [ ] **Step 2: Write `docs/runtime/boxd.md`** (boxd-specific guide)

Should include:
- Full config reference (every field of RuntimeConfig with default + meaning)
- Lifecycle modes (suspend / destroy / detach) with use-cases
- `bindu shell` and `bindu logs` usage
- `BOXD_API_KEY` requirement, where to get one
- Troubleshooting (health check fails, deps fail to install, log dump)

- [ ] **Step 3: Write `docs/runtime/custom-image.md`** (A1 mode)

Should include:
- When to use A1 instead of A2 (reproducibility, gnarly deps)
- Dockerfile template
- How to push to a registry boxd can pull from
- Notes on entry point (`CMD ["bindu", "serve", "--script", "agent.py"]`)

- [ ] **Step 4: Commit**

```bash
git add docs/runtime/
git commit -m "docs(runtime): user-facing docs for the runtime provider"
```

---

## Task 18: E2E test (gated)

**Goal:** one end-to-end test that creates a real boxd VM, ships an echo agent, hits its A2A endpoint, asserts response, destroys VM. **Marked `@pytest.mark.boxd_e2e`, skipped unless `BOXD_E2E=1`. WILL NOT RUN until user explicitly approves.**

**Files:**
- Create: `tests/e2e/__init__.py` (if not present)
- Create: `tests/e2e/runtime/__init__.py`
- Create: `tests/e2e/runtime/test_boxd_e2e.py`
- Create: `tests/e2e/runtime/echo_agent.py` — fixture agent
- Modify: `pytest.ini` — register the `boxd_e2e` marker

- [ ] **Step 1: Add marker registration**

In `pytest.ini`, under `markers`, add:
```
    boxd_e2e: real-boxd-VM e2e tests; require BOXD_E2E=1 and BOXD_API_KEY
```

- [ ] **Step 2: Write the fixture agent**

`tests/e2e/runtime/echo_agent.py`:
```python
"""Echo agent for the boxd_e2e test."""
from bindu.penguin.bindufy import bindufy


def handler(messages):
    if not messages:
        return "no message"
    return [{"role": "assistant", "content": messages[-1].get("content", "")}]


config = {
    "name": "boxd-e2e-echo",
    "description": "echo agent for e2e",
    "deployment": {"url": "http://localhost:3773"},
}

if __name__ == "__main__":
    bindufy(config, handler)
```

- [ ] **Step 3: Write the test**

```python
"""Real-boxd-VM e2e for the runtime provider. Skipped unless BOXD_E2E=1."""
import os
import pytest
import httpx
from pathlib import Path
from bindu.runtime.boxd_provider import BoxdRuntimeProvider
from bindu.runtime import RuntimeConfig

pytestmark = [
    pytest.mark.boxd_e2e,
    pytest.mark.skipif(
        os.environ.get("BOXD_E2E") != "1",
        reason="set BOXD_E2E=1 to enable",
    ),
    pytest.mark.skipif(
        not (os.environ.get("BOXD_API_KEY") or os.environ.get("BOXD_TOKEN")),
        reason="BOXD_API_KEY or BOXD_TOKEN required",
    ),
]


@pytest.mark.asyncio
async def test_full_lifecycle(tmp_path):
    """Deploy → A2A request → assert echo → destroy."""
    # Copy the fixture agent into a tmpdir so source packaging picks it up cleanly
    src_dir = Path(__file__).parent / "echo_agent.py"
    fixture_dir = tmp_path
    (fixture_dir / "echo_agent.py").write_text(src_dir.read_text())
    (fixture_dir / "pyproject.toml").write_text(
        '[project]\nname = "boxd-e2e-echo"\nversion = "0.1.0"\n'
    )

    p = BoxdRuntimeProvider()
    cfg = RuntimeConfig.from_dict({
        "provider": "boxd",
        "auto_suspend": 30,
    })

    handle = None
    try:
        handle = await p.deploy(
            agent_name="boxd-e2e-echo",
            source_dir=fixture_dir,
            config=cfg,
        )
        assert handle.url

        # Hit the A2A endpoint
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                handle.url + "/",
                json={
                    "jsonrpc": "2.0",
                    "id": "1",
                    "method": "message/send",
                    "params": {
                        "message": {"role": "user", "content": "ping"},
                    },
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "ping" in str(data)

    finally:
        if handle is not None:
            await p.on_exit(handle, "destroy")
```

- [ ] **Step 4: DO NOT RUN this test. Verify it parses + collects only.**

```bash
pytest tests/e2e/runtime/ --collect-only
```
Expected: 1 test collected, marked as skipped (because `BOXD_E2E` is unset).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ pytest.ini
git commit -m "test(runtime): gated e2e test (requires BOXD_E2E=1)"
```

---

## Task 19: Final validation pass

- [ ] **Step 1: Run the full bindu test suite**

```bash
pytest tests/unit -q
```
Expected: all green. New runtime tests + all pre-existing.

- [ ] **Step 2: Confirm linting / formatting passes**

```bash
ruff check bindu/runtime tests/unit/runtime
ruff format --check bindu/runtime tests/unit/runtime
```

If formatting is off, run `ruff format bindu/runtime tests/unit/runtime` and commit:
```bash
git add bindu/runtime tests/unit/runtime
git commit -m "style(runtime): ruff format"
```

- [ ] **Step 3: Confirm `pyproject.toml` declares the optional extra**

```bash
grep -A 3 "optional-dependencies" pyproject.toml | head -10
```
Expected: `runtime-boxd = ["boxd>=0.1.0"]` present.

- [ ] **Step 4: Stop. Surface to user.**

Write a status summary covering:
- Files created
- Files modified
- Test counts (new + total)
- The gated e2e test that has not been run
- Confirm: nothing pushed, nothing published, no boxd source touched.

Ask user whether to proceed to e2e (Task 18, gated) — only run if user approves explicitly.

---

## Out of scope (per spec, restated)

- Base image at `ghcr.io/azin-tech/bindu-runtime` — design only, not built/published.
- Source-hash-based ship skip.
- Multi-region / multi-replica.
- Live-reload during dev.
- Non-boxd providers (the abstraction supports them, but nothing ships beyond boxd).
- Push to GetBindu/Bindu — post-PR-readiness, user decision.

## Self-review notes

- **Spec coverage:** every section of the design (1–10) maps to a task: §2→T1, §3+§5→T2/T7, §4→T3+T11, §4 (a2)→T4–T6+T9–T11, §6→T7, §7 routing→T11+T14, §8 errors→threaded through tasks, §9 testing→T15+T18.
- **Type consistency:** `RuntimeHandle` fields used identically in T3, T7, T8–T12, T14, T15. Provider method signatures match the ABC throughout.
- **No "Task N similar to":** every task contains its own code.
- **Open question from design (in-process provider): ship it (Task 7).** Cleaner abstraction.
- **Open question from design (`bindu shell`/`bindu logs`): ship them (Task 16).** Tiny code, big DX.
