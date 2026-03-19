"""Minimal tests for message handler utilities."""

from unittest.mock import AsyncMock, Mock
import pytest
from datetime import datetime, timezone

from bindu.server.handlers.message_handlers import MessageHandlers


class TestMessageHandlers:
    """Test message handler functionality."""

    @pytest.mark.asyncio
    async def test_handle_stream_error_loads_task(self):
        """Test stream error handler loads task."""
        mock_storage = AsyncMock()
        mock_task = {
            "id": "task123",
            "status": {
                "state": "running",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        }
        mock_storage.load_task.return_value = mock_task

        handler = MessageHandlers(scheduler=Mock(), storage=mock_storage)

        task = {"id": "task123"}
        error = Exception("Test error")
        terminal_states = frozenset(["completed", "failed", "canceled"])

        result = await handler._handle_stream_error(
            task,
            "ctx1",
            error,
            terminal_states,  # type: ignore[arg-type]
        )

        assert "kind" in result
        assert result["kind"] == "status-update"
        assert result["task_id"] == "task123"
        mock_storage.load_task.assert_called()

    @pytest.mark.asyncio
    async def test_handle_stream_error_updates_failed_state(self):
        """Test stream error handler updates task to failed."""
        mock_storage = AsyncMock()
        mock_task = {
            "id": "task123",
            "status": {
                "state": "running",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        }
        updated_task = {
            "id": "task123",
            "status": {
                "state": "failed",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        }
        mock_storage.load_task.return_value = mock_task
        mock_storage.update_task.return_value = updated_task

        handler = MessageHandlers(scheduler=Mock(), storage=mock_storage)

        task = {"id": "task123"}
        error = Exception("Test error")
        terminal_states = frozenset(["completed", "failed", "canceled"])

        result = await handler._handle_stream_error(
            task, "ctx1", error, terminal_states
        )  # type: ignore[arg-type]

        assert result["status"]["state"] == "failed"
        assert result["final"] is True
        mock_storage.update_task.assert_called_once_with("task123", state="failed")

    @pytest.mark.asyncio
    async def test_handle_stream_error_handles_load_failure(self):
        """Test stream error handler when task load fails."""
        mock_storage = AsyncMock()
        mock_storage.load_task.side_effect = Exception("Load failed")

        handler = MessageHandlers(scheduler=Mock(), storage=mock_storage)

        task = {"id": "task123"}
        error = Exception("Test error")
        terminal_states = frozenset(["completed", "failed", "canceled"])

        result = await handler._handle_stream_error(
            task, "ctx1", error, terminal_states
        )  # type: ignore[arg-type]

        assert "kind" in result
        assert result["status"]["state"] == "failed"
