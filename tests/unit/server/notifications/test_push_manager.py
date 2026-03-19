"""Minimal tests for push notification manager."""

from unittest.mock import AsyncMock, Mock
import pytest
from uuid import uuid4

from bindu.server.notifications.push_manager import PushNotificationManager


class TestPushNotificationManager:
    """Test push notification manager functionality."""

    def test_manager_initialization(self):
        """Test manager initializes with default values."""
        manager = PushNotificationManager()
        
        assert manager.manifest is None
        assert manager.storage is None
        assert manager.notification_service is not None
        assert len(manager._push_notification_configs) == 0
        assert len(manager._notification_sequences) == 0

    def test_manager_initialization_with_manifest(self):
        """Test manager initialization with manifest."""
        mock_manifest = Mock()
        manager = PushNotificationManager(manifest=mock_manifest)
        
        assert manager.manifest == mock_manifest

    @pytest.mark.asyncio
    async def test_initialize_without_storage(self):
        """Test initialize skips loading when no storage configured."""
        manager = PushNotificationManager()
        
        await manager.initialize()
        
        # Should complete without error
        assert len(manager._push_notification_configs) == 0

    @pytest.mark.asyncio
    async def test_initialize_with_storage(self):
        """Test initialize loads configs from storage."""
        mock_storage = AsyncMock()
        mock_storage.load_all_webhook_configs.return_value = {}
        
        manager = PushNotificationManager(storage=mock_storage)
        
        await manager.initialize()
        
        mock_storage.load_all_webhook_configs.assert_called_once()

    def test_is_push_supported_without_manifest(self):
        """Test push support check without manifest."""
        manager = PushNotificationManager()
        
        assert manager.is_push_supported() is False

    def test_is_push_supported_with_manifest(self):
        """Test push support check with manifest."""
        mock_manifest = Mock()
        mock_manifest.capabilities = {"push_notifications": True}
        
        manager = PushNotificationManager(manifest=mock_manifest)
        
        assert manager.is_push_supported() is True

    def test_get_global_webhook_config_without_manifest(self):
        """Test getting global webhook config without manifest."""
        manager = PushNotificationManager()
        
        config = manager.get_global_webhook_config()
        
        assert config is None

    def test_get_global_webhook_config_with_url(self):
        """Test getting global webhook config with URL."""
        mock_manifest = Mock()
        mock_manifest.global_webhook_url = "https://example.com/webhook"
        mock_manifest.global_webhook_token = None
        
        manager = PushNotificationManager(manifest=mock_manifest)
        
        config = manager.get_global_webhook_config()
        
        assert config is not None
        assert config["url"] == "https://example.com/webhook"

    def test_get_effective_webhook_config_task_specific(self):
        """Test getting effective config prefers task-specific."""
        mock_manifest = Mock()
        mock_manifest.global_webhook_url = "https://global.com/webhook"
        
        manager = PushNotificationManager(manifest=mock_manifest)
        task_id = uuid4()
        
        manager._push_notification_configs[task_id] = {
            "id": task_id,
            "url": "https://task.com/webhook"
        }
        
        config = manager.get_effective_webhook_config(task_id)
        
        assert config is not None
        assert config["url"] == "https://task.com/webhook"

    def test_get_effective_webhook_config_falls_back_to_global(self):
        """Test getting effective config falls back to global."""
        mock_manifest = Mock()
        mock_manifest.global_webhook_url = "https://global.com/webhook"
        mock_manifest.global_webhook_token = None
        
        manager = PushNotificationManager(manifest=mock_manifest)
        task_id = uuid4()
        
        config = manager.get_effective_webhook_config(task_id)
        
        assert config is not None
        assert config["url"] == "https://global.com/webhook"
