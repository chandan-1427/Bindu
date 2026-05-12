"""External dependency stubs for testing.

This module provides lightweight stubs for external dependencies to avoid
requiring heavy optional dependencies during testing.
"""

import sys
from types import ModuleType


def setup_opentelemetry_stubs():
    """Set up OpenTelemetry stubs for testing."""
    ot_trace = ModuleType("opentelemetry.trace")

    class _Span:
        def is_recording(self):
            return True

        def add_event(self, *args, **kwargs):
            return None

        def set_attributes(self, *args, **kwargs):
            return None

        def set_attribute(self, *args, **kwargs):
            return None

        def set_status(self, *args, **kwargs):
            return None

    def get_current_span():
        return _Span()

    class _SpanCtx:
        def __enter__(self):
            return _Span()

        def __exit__(self, exc_type, exc, tb):
            return False

    class _Tracer:
        def start_as_current_span(self, name: str, **kwargs):
            return _SpanCtx()

        def start_span(self, name: str, **kwargs):
            return _Span()

    class _StatusCode:
        OK = "OK"
        ERROR = "ERROR"

    class _Status:
        def __init__(self, *args, **kwargs):
            pass

    ot_trace.get_current_span = get_current_span  # type: ignore[attr-defined]
    ot_trace.get_tracer = lambda name: _Tracer()  # type: ignore[attr-defined]
    ot_trace.Status = _Status  # type: ignore[attr-defined]
    ot_trace.StatusCode = _StatusCode  # type: ignore[attr-defined]
    ot_trace.Span = _Span  # type: ignore[attr-defined]
    ot_trace.use_span = lambda span: _SpanCtx()  # type: ignore[attr-defined]

    # Setup metrics
    metrics_mod = ModuleType("opentelemetry.metrics")

    class _Counter:
        def add(self, *_args, **_kwargs):
            return None

    class _Histogram:
        def record(self, *_args, **_kwargs):
            return None

    class _UpDownCounter:
        def add(self, *_args, **_kwargs):
            return None

    class _Meter:
        def create_counter(self, *_args, **_kwargs):
            return _Counter()

        def create_histogram(self, *_args, **_kwargs):
            return _Histogram()

        def create_up_down_counter(self, *_args, **_kwargs):
            return _UpDownCounter()

    def get_meter(name: str):
        return _Meter()

    metrics_mod.get_meter = get_meter  # type: ignore[attr-defined]

    # Register modules
    op_root = ModuleType("opentelemetry")
    op_root.metrics = metrics_mod  # type: ignore[attr-defined]
    op_root.trace = ot_trace  # type: ignore[attr-defined]

    sys.modules["opentelemetry"] = op_root
    sys.modules["opentelemetry.trace"] = ot_trace
    sys.modules["opentelemetry.metrics"] = metrics_mod
