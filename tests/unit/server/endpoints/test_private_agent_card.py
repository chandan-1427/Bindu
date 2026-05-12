"""Tests for the private agent-card endpoint (allowlist gate)."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.routing import Route
from starlette.testclient import TestClient

from bindu.server.endpoints.private_agent_card import private_agent_card_endpoint


# ---------------------------------------------------------------------------
# Fixtures — a minimal app + a fake auth middleware that stamps caller DID
# onto request.state (which is exactly what the real Hydra middleware does).
# ---------------------------------------------------------------------------


class _StubAuthMiddleware(BaseHTTPMiddleware):
    """Stand-in for the Hydra middleware.

    Real Hydra middleware verifies bearer + DID signature and stamps
    ``scope["state"]["user"] = {"client_id": "did:..."}``. Here we read a
    test-only ``X-Test-DID`` header to control what the handler sees, so
    each test case can drive caller identity without doing real OAuth.
    """

    async def dispatch(self, request, call_next):
        test_did = request.headers.get("X-Test-DID")
        if test_did:
            request.scope.setdefault("state", {})
            request.scope["state"]["user"] = {"client_id": test_did}
        return await call_next(request)


def _make_manifest(
    *,
    skills: list[dict] | None = None,
    private_skills: list[dict] | None = None,
    allowed_dids: list[str] | None = None,
) -> MagicMock:
    """Build a manifest stub that quacks like the real AgentManifest enough
    for the endpoint to produce a card."""
    m = MagicMock()
    m.id = uuid4()
    m.name = "test_agent"
    m.description = "test"
    # Use `is None` instead of `or` so callers can pass [] to mean "really empty"
    # (vs "use defaults"). The 404-on-no-private-surface test needs this.
    m.skills = (
        [{"id": "public-1", "name": "Public Skill"}] if skills is None else skills
    )
    m.private_skills = (
        [
            {"id": "private-1", "name": "Private Skill A"},
            {"id": "private-2", "name": "Private Skill B"},
        ]
        if private_skills is None
        else private_skills
    )
    m.allowed_dids = (
        ["did:bindu:alice:agent:1"] if allowed_dids is None else allowed_dids
    )
    m.kind = "agent"
    m.num_history_sessions = 0
    m.extra_data = {}
    m.debug_mode = False
    m.debug_level = 1
    m.monitoring = False
    m.telemetry = True
    m.agent_trust = None
    m.capabilities = {}
    return m


def _build_app(manifest, agent_url: str = "http://test"):
    """Spin up a tiny Starlette app with the stub auth + private endpoint."""
    app_mock = MagicMock()
    app_mock.manifest = manifest
    app_mock.url = agent_url
    app_mock.version = "1.0.0"
    app_mock._private_agent_card_json_schema = None

    async def handler(request: Request):
        return await private_agent_card_endpoint(app_mock, request)

    return Starlette(
        routes=[Route("/agent/private.json", handler, methods=["GET"])],
        middleware=[
            __import__("starlette.middleware", fromlist=["Middleware"]).Middleware(
                _StubAuthMiddleware
            )
        ],
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestAllowlistGate:
    """The middleware authenticates; the manifest's `allowed_dids` decides
    whether that authenticated caller actually gets the catalog."""

    def test_caller_in_allowlist_gets_merged_card(self):
        manifest = _make_manifest(
            allowed_dids=["did:bindu:alice:agent:1", "did:bindu:bob:agent:2"]
        )
        client = TestClient(_build_app(manifest))

        r = client.get(
            "/agent/private.json",
            headers={"X-Test-DID": "did:bindu:alice:agent:1"},
        )

        assert r.status_code == 200
        body = r.json()
        skill_ids = {s["id"] for s in body["skills"]}
        # Both public and private skills come through
        assert "public-1" in skill_ids
        assert "private-1" in skill_ids
        assert "private-2" in skill_ids

    def test_caller_not_in_allowlist_gets_403(self):
        manifest = _make_manifest(allowed_dids=["did:bindu:alice:agent:1"])
        client = TestClient(_build_app(manifest))

        r = client.get(
            "/agent/private.json",
            headers={"X-Test-DID": "did:bindu:eve:attacker:1"},
        )

        assert r.status_code == 403
        assert "not authorized" in r.json()["error"].lower()

    def test_no_caller_did_at_all_gets_401(self):
        # If the auth middleware didn't run (or didn't stamp a DID), we
        # refuse with 401. In production the Hydra middleware would
        # already have returned 401 — this is the defensive backstop.
        manifest = _make_manifest()
        client = TestClient(_build_app(manifest))

        r = client.get("/agent/private.json")  # no X-Test-DID header

        assert r.status_code == 401
        assert "authentication" in r.json()["error"].lower()


class TestMergedCardShape:
    """When the gate opens, the response should look like the public agent
    card with extra skills — same envelope, longer skills list."""

    def test_merged_card_includes_all_skills(self):
        manifest = _make_manifest(
            skills=[
                {"id": "p1", "name": "Public 1"},
                {"id": "p2", "name": "Public 2"},
            ],
            private_skills=[
                {"id": "x1", "name": "Private 1"},
            ],
            allowed_dids=["did:bindu:alice:agent:1"],
        )
        client = TestClient(_build_app(manifest))

        r = client.get(
            "/agent/private.json",
            headers={"X-Test-DID": "did:bindu:alice:agent:1"},
        )

        assert r.status_code == 200
        skills = r.json()["skills"]
        assert len(skills) == 3
        # Order: public first, private appended
        assert [s["id"] for s in skills] == ["p1", "p2", "x1"]

    def test_documentation_path_uses_agent_url(self):
        manifest = _make_manifest(allowed_dids=["did:bindu:alice:agent:1"])
        client = TestClient(_build_app(manifest, agent_url="https://acme.com"))

        r = client.get(
            "/agent/private.json",
            headers={"X-Test-DID": "did:bindu:alice:agent:1"},
        )

        # AgentCard serializes with camelCase aliases on the wire — the
        # field is `documentation_path` on the model but `documentationPath`
        # in the JSON envelope.
        for skill in r.json()["skills"]:
            assert skill["documentationPath"].startswith(
                "https://acme.com/agent/skills/"
            )


class TestEndpointSafety:
    """Edge cases that shouldn't crash the handler."""

    def test_manifest_with_no_private_surface_returns_404(self):
        # Defensive: we don't normally register the route in this case,
        # but if something else routed here, refuse rather than leak.
        manifest = _make_manifest(private_skills=[], allowed_dids=[])
        client = TestClient(_build_app(manifest))

        r = client.get(
            "/agent/private.json",
            headers={"X-Test-DID": "did:bindu:alice:agent:1"},
        )

        assert r.status_code == 404


class TestManifestFieldPlumbing:
    """The bindufy config → AgentManifest path must carry the new fields
    through. This is the boring integration cousin of the wire-level tests
    above."""

    def test_manifest_default_has_empty_private_surface(self):
        # If the operator doesn't set them, both default to empty list
        # (not None), so consumers can iterate without None-checks.
        from bindu.common.models import AgentManifest
        import dataclasses

        fields_by_name = {f.name: f for f in dataclasses.fields(AgentManifest)}
        ps = fields_by_name["private_skills"]
        ad = fields_by_name["allowed_dids"]
        # default_factory presence is what matters
        assert ps.default_factory is list
        assert ad.default_factory is list

    def test_config_validator_accepts_the_new_keys(self):
        from bindu.penguin.config_validator import ConfigValidator

        out = ConfigValidator.validate_and_process(
            {
                "author": "you@example.com",
                "name": "test",
                "deployment": {"url": "http://localhost:3773"},
                "private_skills": ["skills/example"],
                "allowed_dids": ["did:bindu:bob:agent:1"],
            }
        )

        assert out["private_skills"] == ["skills/example"]
        assert out["allowed_dids"] == ["did:bindu:bob:agent:1"]
