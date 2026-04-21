"""Hermes-Agent via Bindu.

Bindufies the Hermes `AIAgent` as an A2A microservice with DID identity,
OAuth2-ready HTTP on port 3773, optional FRP tunnel, and x402 payments.

The adapter lives inside the hermes-agent repo under `bindu_adapter/` and
ships with the `[bindu]` optional extra. This example is just a pointer
that defers to it.

Usage:
    # From a Python 3.12+ environment:
    uv pip install 'hermes-agent[bindu]'
    python examples/hermes_agent/hermes_simple_example.py

    # Or use the CLI shortcut (same thing):
    uv run hermes bindu serve

Environment:
    OPENROUTER_API_KEY  (or ANTHROPIC_API_KEY, whichever the chosen model needs)
    HERMES_BINDU_MODEL  default "anthropic/claude-sonnet-4.6"
    HERMES_BINDU_TIER   "read" (default) | "sandbox" | "full"
    HERMES_BINDU_URL    default "http://localhost:3773"

Tiers gate the toolset so a tunneled deployment is safe by default:
    read    — web search + web extract only
    sandbox — adds filesystem read/write and execute_code
    full    — everything (terminal, browser, MCP). Local-only.
"""

from __future__ import annotations

import os
import sys


def main() -> None:
    try:
        from bindu_adapter.serve import run
    except ImportError:
        sys.stderr.write(
            "hermes-agent is not installed with the [bindu] extra.\n"
            "Install it on Python 3.12+:\n"
            "    uv pip install 'hermes-agent[bindu]'\n"
        )
        sys.exit(1)

    run(
        model=os.getenv("HERMES_BINDU_MODEL"),
        tier=os.getenv("HERMES_BINDU_TIER"),
        url=os.getenv("HERMES_BINDU_URL"),
        name=os.getenv("HERMES_BINDU_NAME", "hermes"),
    )


if __name__ == "__main__":
    main()
