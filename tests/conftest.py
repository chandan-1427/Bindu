"""Pytest configuration and fixtures for Bindu tests.

This file contains:
1. External dependency stubs (OpenTelemetry) to avoid heavy test dependencies
2. Core pytest configuration (asyncio event loop)
3. Imports of organized fixtures from tests/fixtures/

Most fixtures are now organized in tests/fixtures/ modules for better maintainability.
"""

# ============================================================================
# EXTERNAL DEPENDENCY STUBS
# These stubs allow tests to run without installing heavy optional dependencies.
# x402 v2 is a required runtime dep now, so it's no longer stubbed.
# ============================================================================

from tests.conftest_stubs import setup_opentelemetry_stubs

setup_opentelemetry_stubs()

# ============================================================================
# PYTEST CONFIGURATION
# ============================================================================

import asyncio  # noqa: E402

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session.

    This fixture ensures all async tests share the same event loop,
    preventing issues with multiple event loops in tests.
    """
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


# ============================================================================
# FIXTURE IMPORTS
# All fixtures are now organized in tests/fixtures/ for better maintainability
# ============================================================================

pytest_plugins = [
    "tests.fixtures.storage_fixtures",
    "tests.fixtures.auth_fixtures",
    "tests.fixtures.payment_fixtures",
    "tests.fixtures.mock_fixtures",
]
