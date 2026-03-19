"""Minimal tests for HTTP exceptions."""

from bindu.utils.exceptions import (
    HTTPError,
    HTTPConnectionError,
    HTTPTimeoutError,
    HTTPClientError,
    HTTPServerError,
)


class TestHTTPExceptions:
    """Test HTTP exception hierarchy."""

    def test_http_error_base_exception(self):
        """Test HTTPError is base for all HTTP exceptions."""
        error = HTTPError("Test error")

        assert isinstance(error, Exception)
        assert str(error) == "Test error"

    def test_http_client_error_4xx(self):
        """Test HTTPClientError for 4xx responses."""
        error = HTTPClientError("Not found", status=404)

        assert isinstance(error, HTTPError)
        assert error.status == 404
        assert "Not found" in str(error)

    def test_http_server_error_5xx(self):
        """Test HTTPServerError for 5xx responses."""
        error = HTTPServerError("Internal error", status=500)

        assert isinstance(error, HTTPError)
        assert error.status == 500

    def test_http_connection_error(self):
        """Test HTTPConnectionError for connection failures."""
        error = HTTPConnectionError("Connection refused")

        assert isinstance(error, HTTPError)
        assert "Connection refused" in str(error)

    def test_http_timeout_error(self):
        """Test HTTPTimeoutError for timeout failures."""
        error = HTTPTimeoutError("Request timeout")

        assert isinstance(error, HTTPError)
        assert "timeout" in str(error).lower()
