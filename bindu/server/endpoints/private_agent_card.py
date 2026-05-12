"""Private agent-card endpoint, gated by Hydra auth + DID allowlist.

Same shape as the public agent card, but the response includes the agent's
``private_skills`` and is only returned to callers whose DID appears in
``manifest.allowed_dids``.

Two layers gate this endpoint:

1. **Hydra middleware** (already in front of every non-public route) —
   verifies the OAuth bearer + DID signature. If those fail, the request
   never reaches this handler.
2. **The allowlist check below** — even an authenticated DID is rejected
   with 403 unless the operator added it to ``allowed_dids``.

Endpoint path is deliberately NOT under ``/.well-known/`` because the
``AuthSettings.public_endpoints`` glob ``/.well-known/*`` would skip
auth entirely.
"""

from __future__ import annotations

from time import time
from typing import cast
from uuid import UUID

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from bindu.common.protocol.types import AgentCard, AgentCapabilities, agent_card_ta
from bindu.server.applications import BinduApplication
from bindu.utils.logging import get_logger

from .agent_card import (
    A2A_PROTOCOL_VERSION,
    DEFAULT_AGENT_DESCRIPTION,
    DEFAULT_INPUT_MODES,
    DEFAULT_OUTPUT_MODES,
    _serialize_extensions,
)
from .utils import get_client_ip, handle_endpoint_errors

logger = get_logger("bindu.server.endpoints.private_agent_card")


def _create_private_agent_card(app: BinduApplication) -> AgentCard:
    """Build the merged agent card (public + private skills).

    Mirrors the public ``create_agent_card`` exactly except the skills
    list combines ``manifest.skills`` and ``manifest.private_skills``.
    Cached on the app so we only build it once.
    """
    if app.manifest is None:
        raise ValueError("Application manifest is required to create agent card")

    manifest = app.manifest

    # Match the public agent_card.py shape exactly — `.append()` in a loop
    # rather than a list comprehension. Same data, but the inferred type
    # plays nicer with `AgentCard.skills: list[Skill]` invariance.
    minimal_skills = []
    for skill in list(manifest.skills) + list(manifest.private_skills):
        minimal_skills.append(
            {
                "id": skill["id"],
                "name": skill["name"],
                "documentation_path": f"{app.url}/agent/skills/{skill['id']}",
            }
        )

    agent_id = manifest.id if isinstance(manifest.id, UUID) else UUID(manifest.id)
    capabilities = dict(manifest.capabilities)
    _serialize_extensions(capabilities)

    return AgentCard(
        id=agent_id,
        name=manifest.name,
        description=manifest.description or DEFAULT_AGENT_DESCRIPTION,
        url=app.url,
        version=app.version,
        protocol_version=A2A_PROTOCOL_VERSION,
        skills=minimal_skills,
        capabilities=cast(AgentCapabilities, capabilities),
        kind=manifest.kind,
        num_history_sessions=manifest.num_history_sessions,
        extra_data=manifest.extra_data
        or {"created": int(time()), "server_info": "bindu Agent Server"},
        debug_mode=manifest.debug_mode,
        debug_level=manifest.debug_level,
        monitoring=manifest.monitoring,
        telemetry=manifest.telemetry,
        agent_trust=manifest.agent_trust,
        default_input_modes=DEFAULT_INPUT_MODES,
        default_output_modes=DEFAULT_OUTPUT_MODES,
    )


@handle_endpoint_errors("private agent card")
async def private_agent_card_endpoint(
    app: BinduApplication, request: Request
) -> Response:
    """Return the agent card with private_skills, for allowlisted DIDs only.

    Flow:
      1. Hydra middleware has already run — caller DID is on ``request.state.user``.
      2. We refuse if (a) the manifest declares no private surface or
         (b) the caller's DID isn't on the manifest's allowlist.
      3. Otherwise return the merged card (public + private skills).
    """
    client_ip = get_client_ip(request)

    if app.manifest is None:
        return JSONResponse(
            {"error": "Application manifest not initialized"}, status_code=503
        )

    # No private surface configured → this endpoint shouldn't even be
    # reachable in practice (we don't register it), but be defensive.
    if not app.manifest.private_skills and not app.manifest.allowed_dids:
        return JSONResponse(
            {"error": "Private skills not configured for this agent"},
            status_code=404,
        )

    # Pull the caller DID that Hydra middleware stamped on the scope.
    user_info: dict = getattr(request.state, "user", None) or {}
    caller_did = user_info.get("client_id")

    if not caller_did:
        # Defensive: if Hydra is disabled but the route still hits, refuse.
        logger.warning(
            "private_catalog_access caller=<none> ip=%s result=denied reason=no_auth",
            client_ip,
        )
        return JSONResponse(
            {"error": "Authentication required for private agent card"},
            status_code=401,
        )

    if caller_did not in app.manifest.allowed_dids:
        logger.warning(
            "private_catalog_access caller=%s ip=%s result=denied reason=not_in_allowlist",
            caller_did,
            client_ip,
        )
        return JSONResponse(
            {"error": "DID not authorized for this agent's private skills"},
            status_code=403,
        )

    # Cache the merged card on the app — same lazy pattern as the public one.
    if app._private_agent_card_json_schema is None:
        logger.debug("Generating private agent card schema")
        app._private_agent_card_json_schema = agent_card_ta.dump_json(
            _create_private_agent_card(app), by_alias=True
        )

    logger.info(
        "private_catalog_access caller=%s ip=%s result=granted",
        caller_did,
        client_ip,
    )
    return Response(
        content=app._private_agent_card_json_schema,
        media_type="application/json",
    )
