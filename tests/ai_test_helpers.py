import pytest
from telegram_dashboard.errors import ApiError

AI = dict(ai_agent_command="cat", ai_model="", ai_effort="")  # `cat` echoes the prompt back


async def expect(code, coro):
    with pytest.raises(ApiError) as e:
        await coro
    assert e.value.code == code
