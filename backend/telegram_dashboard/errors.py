class ApiError(Exception):
    def __init__(
        self, status: int, code: str, *, retry_after: int | None = None, detail: str | None = None
    ):
        super().__init__(code)
        self.status = status
        self.code = code
        self.retry_after = retry_after
        self.detail = detail


def int_or_404(value: str, code: str = "reply_not_found") -> int:
    try:
        return int(value)
    except ValueError:
        raise ApiError(404, code) from None
