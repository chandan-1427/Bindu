"""Pytest configuration and fixtures for Bindu tests.

OpenTelemetry and x402 are both runtime deps now; the conftest_stubs
that shadowed them with in-memory fakes are gone. Tests run against
the real installs.
"""

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
