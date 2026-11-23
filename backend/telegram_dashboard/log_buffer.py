"""The last warnings / errors of this server, in memory: Cài đặt › Liên hệ attaches them to a bug report.
Every install has them (the release launcher writes no server.log); nothing is written to disk."""

import logging
import time
from collections import deque

MAX_LINES = 300
MAX_CHARS = 2000  # one record (a traceback included)


class _Recent(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.lines: deque[tuple[float, str]] = deque(maxlen=MAX_LINES)
        self.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%m-%d %H:%M:%S"))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.lines.append((record.created, self.format(record)[:MAX_CHARS]))
        except Exception:  # noqa: BLE001 - a log handler must never raise into the code that logged
            self.handleError(record)


HANDLER = _Recent()


def install() -> None:
    root = logging.getLogger()
    if HANDLER not in root.handlers:
        root.addHandler(HANDLER)


def recent(hours: float = 24) -> list[str]:
    cut = time.time() - hours * 3600
    return [line for at, line in list(HANDLER.lines) if at >= cut]
