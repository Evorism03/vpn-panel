"""Central event broadcast for SSE. Import this anywhere to push events to all connected admins."""
from typing import Callable

_handler: Callable[[str], None] | None = None


def set_handler(fn: Callable[[str], None]):
    global _handler
    _handler = fn


def push(event: str):
    if _handler:
        _handler(event)
