import json
import os
import shlex
import shutil
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 8765


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def _on_path(command: str) -> bool:
    """Is the command's executable installed?"""
    try:
        return shutil.which(shlex.split(command)[0]) is not None
    except (ValueError, IndexError):
        return False


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


@dataclass(frozen=True)
class Settings:
    root: Path = ROOT
    host: str = HOST
    port: int = PORT
    app_origin: str = f"http://{HOST}:{PORT}"
    telegram_api_id: int | None = None
    telegram_api_hash: str | None = None
    # All AI runs through the Claude Code CLI on this machine (its own claude.ai login).
    # Drafts/summaries/digests: prompt on stdin, text on stdout, tools off.
    ai_agent_command: str = 'claude -p --tools ""'
    # Defaults below; the model/effort picked in the dashboard (data/claude.json) win over them.
    ai_model: str = "haiku"  # model for drafts/summaries/digests ("" = the CLI default)
    # Agent used when a project is selected: read-only tools, run with cwd = project.
    ai_agent_project_command: str = (
        "claude -p --tools Read,Grep,Glob --allowedTools Read,Grep,Glob"
    )
    # Interactive agent opened in Terminal for "Tạo task" (you approve each tool there).
    ai_task_command: str = "claude"
    ai_task_model: str = "haiku"  # model for tasks and the AI Agent ("" = the CLI default)
    ai_task_effort: str = "medium"  # low|medium|high|xhigh|max ("" = the CLI default)
    # macOS banner for each live tag (NOTIFY=0 turns it off).
    notify: bool = True
    youtrack_url: str | None = None
    youtrack_token: str | None = field(default=None, repr=False)
    youtrack_project: str | None = None  # short name, e.g. "SDK"
    # Per-message consent grants before AI use (Telegram API Terms). Off only for personal use.
    ai_require_consent: bool = True

    @property
    def data_dir(self) -> Path:
        return self.root / "data"

    @property
    def youtrack_path(self) -> Path:
        return self.data_dir / "youtrack.json"  # URL + token pasted in Settings; wins over .env

    @property
    def claude_prefs_path(self) -> Path:
        return self.data_dir / "claude.json"  # model/effort picked in the Claude dialog

    @property
    def db_path(self) -> Path:
        return self.data_dir / "dashboard.sqlite3"

    @property
    def session_path(self) -> Path:
        return self.data_dir / "account"  # Telethon appends .session

    @property
    def static_dir(self) -> Path:
        return self.root / "web" / "out"

    @property
    def host_header(self) -> str:
        return f"{self.host}:{self.port}"

    @property
    def telegram_configured(self) -> bool:
        return self.telegram_api_id is not None and bool(self.telegram_api_hash)

    @property
    def youtrack_configured(self) -> bool:
        return bool(self.youtrack_url and self.youtrack_token and self.youtrack_project)

    @property
    def ai_configured(self) -> bool:
        return _on_path(self.ai_agent_command)

    def ensure_data_dir(self) -> None:
        self.data_dir.mkdir(mode=0o700, exist_ok=True)
        self.data_dir.chmod(0o700)

    @classmethod
    def from_env(cls, root: Path = ROOT) -> Settings:
        _load_dotenv(root / ".env")
        env = os.environ
        api_id = env.get("TELEGRAM_API_ID", "").strip()
        saved = _read_json(root / "data" / "youtrack.json")
        return cls(
            root=root,
            app_origin=env.get("APP_ORIGIN") or f"http://{HOST}:{PORT}",
            telegram_api_id=int(api_id) if api_id.isdigit() else None,
            telegram_api_hash=env.get("TELEGRAM_API_HASH") or None,
            ai_agent_command=env.get("AI_AGENT_COMMAND") or Settings.ai_agent_command,
            ai_model=env["AI_MODEL"].strip() if "AI_MODEL" in env else Settings.ai_model,
            ai_agent_project_command=env.get("AI_AGENT_PROJECT_COMMAND")
            or Settings.ai_agent_project_command,
            ai_task_command=env.get("AI_TASK_COMMAND") or Settings.ai_task_command,
            ai_task_model=env["AI_TASK_MODEL"].strip() if "AI_TASK_MODEL" in env else Settings.ai_task_model,
            ai_task_effort=env["AI_TASK_EFFORT"].strip() if "AI_TASK_EFFORT" in env else Settings.ai_task_effort,
            notify=env.get("NOTIFY", "1").strip() != "0",
            youtrack_url=saved.get("url") or env.get("YOUTRACK_URL") or env.get("YT_URL") or None,
            youtrack_token=saved.get("token")
            or env.get("YOUTRACK_TOKEN")
            or env.get("YT_TOKEN")
            or None,
            youtrack_project=env.get("YOUTRACK_PROJECT") or None,
            ai_require_consent=env.get("AI_REQUIRE_CONSENT", "1").strip() != "0",
        )
