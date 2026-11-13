import asyncio
import contextlib
import functools
import json
import os
import shlex
import shutil
import signal
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 8765


def default_home(root: Path) -> Path:
    """Packaged install: the launcher sets TD_HOME (outside versions/, so updates keep the data)."""
    home = os.environ.get("TD_HOME")
    return Path(home) if home else root


def left_file(root: Path) -> Path:
    return default_home(root) / "data_left"  # an old data/ a move could not delete: local_data.sweep_left


def kept_file(root: Path) -> Path:
    # the data/ in use before "Dùng dữ liệu ở đó": left as it was, still not for AI runs
    # ponytail: the last one only; a second switch drops the first from the deny rules
    return default_home(root) / "data_kept"


def home_file(root: Path) -> Path:
    """Where "Đổi thư mục" keeps its path: in the install, so another install or a test's own root (the e2e
    fixture server) never lands on this one's data."""
    return default_home(root) / "data_home"


@functools.cache  # data_dir is read all the time; only local_data._set_home writes the file (and clears this)
def _pointed(f: Path) -> Path | None:
    with contextlib.suppress(OSError):
        if p := f.read_text().strip():
            return Path(p)
    return None


def data_home(root: Path) -> Path:
    """The folder holding data/ and agent-links/: the one picked in Cài đặt › Dữ liệu, else the install's."""
    return _pointed(home_file(root)) or default_home(root)


def data_root(root: Path) -> Path:
    return data_home(root) / "data"


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


SECRET_ENV = (
    "TELEGRAM_",
    "YOUTRACK_",
    "YT_",  # .env lands in os.environ (yt_dashboard reads it)
    # the user's other credentials: an agent's shell has no business with them (the AI CLIs keep theirs)
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "AWS_",
    "AZURE_",
    "GOOGLE_APPLICATION_CREDENTIALS",
)
RUN_DIR = Path.home() / ".telegram_dashboard"  # outside every install's data/: one server per machine
DB_NAME = "dashboard.sqlite3"


def child_env() -> dict[str, str]:
    """os.environ minus secrets (this app's Telegram API / YouTrack token, cloud and git tokens): for AI CLI runs."""
    return {k: v for k, v in os.environ.items() if not k.startswith(SECRET_ENV)}


def api_token_path() -> Path:
    return RUN_DIR / "api_token"


def ensure_api_token() -> str:
    """The local API's token (auth.py), made once (0600) and kept across restarts so the browser's cookie
    stays valid. Machine-wide like the server lock: any install's launcher opens the running server."""
    path = api_token_path()
    with contextlib.suppress(OSError):
        if tok := path.read_text().strip():
            return tok
    import secrets

    RUN_DIR.mkdir(mode=0o700, exist_ok=True)
    tok = secrets.token_urlsafe(32)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        f.write(tok)
    return tok


async def run_cli(
    cmd: list[str], stdin: bytes | None = None, timeout: float = 30, cwd=None, merge: bool = False
) -> tuple[int, bytes, bytes] | None:
    """(exit code, stdout, stderr) of a short CLI call, run outside any project (`merge`: stderr into
    stdout). None when it did not start or ran past `timeout`; a timed-out or abandoned call is
    killed and reaped, never left running."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=cwd or tempfile.gettempdir(), env=child_env(),
            stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT if merge else asyncio.subprocess.PIPE,
        )  # fmt: skip
    except OSError:
        return None
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin), timeout)
    except TimeoutError:
        return None
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
    return proc.returncode, out, err or b""


def kill_tree(proc, term: bool = False) -> None:
    """SIGKILL (`term`: SIGTERM) a CLI started with start_new_session=True and everything it spawned
    (shell commands, background jobs). Windows: the CLI only."""
    # ponytail: no `taskkill /T` on Windows; add it if agents there leave children behind.
    if os.name == "posix":
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(proc.pid, signal.SIGTERM if term else signal.SIGKILL)
    if proc.returncode is None:
        with contextlib.suppress(ProcessLookupError):
            proc.terminate() if term else proc.kill()


def on_path(command: str) -> bool:
    """Is the command's executable installed?"""
    try:
        return shutil.which(shlex.split(command)[0]) is not None
    except ValueError, IndexError:
        return False


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
    except OSError, ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def write_private_json(path: Path, data) -> None:
    """Atomic, owner-only (0600) JSON write for tokens/prefs kept in data/."""
    path.parent.mkdir(mode=0o700, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(data, f)
    tmp.replace(path)


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
    ai_effort: str = "medium"  # low|medium|high|xhigh|max ("" = the CLI default)
    # Agent used when a project is selected: read-only tools, run with cwd = project.
    ai_agent_project_command: str = "claude -p --tools Read,Grep,Glob,Skill --allowedTools Read,Grep,Glob,Skill"
    # Headless agent for tasks / AI Agent (`claude -p` per turn, run with cwd = project).
    ai_task_command: str = "claude"
    ai_task_model: str = "sonnet"  # model for tasks and the AI Agent ("" = the CLI default)
    ai_task_effort: str = "medium"  # low|medium|high|xhigh|max ("" = the CLI default)
    # Other agent CLIs that can stand in for claude (picked per kind of run; see providers.py).
    codex_command: str = "codex"
    antigravity_command: str = "agy"
    # macOS banner for each live tag (NOTIFY=0 turns it off).
    notify: bool = True
    # Reaction sent on Telegram when a tag is marked done (removed on reopen); empty = off.
    done_reaction: str = "👍"
    # Your Telegram @username for drafts; empty = read from the logged-in account.
    telegram_me: str = ""
    youtrack_url: str | None = None
    youtrack_token: str | None = field(default=None, repr=False)
    youtrack_project: str | None = None  # short name, e.g. "SDK"
    api_token: str | None = field(default=None, repr=False)  # local API auth (auth.py); None = off (tests)

    @property
    def data_dir(self) -> Path:
        return data_root(self.root)

    @property
    def secret_dirs(self) -> list[Path]:
        """What an AI run may not read: data/, the install's own data/ (a log from before a move holds the
        sign-in link), an old data/ a move has not managed to delete yet, and the one kept by "Dùng dữ liệu ở đó"."""
        files = (left_file(self.root), kept_file(self.root))
        dirs = [self.data_dir, default_home(self.root) / "data", *map(_pointed, files)]
        return list(dict.fromkeys(d.resolve() for d in dirs if d))

    @property
    def youtrack_path(self) -> Path:
        return self.data_dir / "youtrack.json"  # URL + token pasted in Settings; wins over .env

    @property
    def config_path(self) -> Path:
        return self.data_dir / "config.json"  # Telegram API + consent set in the UI; wins over .env

    def save_config(self, **values) -> None:
        write_private_json(self.config_path, {**_read_json(self.config_path), **values})

    @property
    def claude_prefs_path(self) -> Path:
        return self.data_dir / "claude.json"  # model/effort picked in the Claude dialog

    @property
    def db_path(self) -> Path:
        return self.data_dir / DB_NAME

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
        return bool(self.youtrack_url and self.youtrack_token)  # the project is picked per ticket

    @property
    def ai_configured(self) -> bool:
        return on_path(self.ai_agent_command)

    def ensure_data_dir(self) -> None:
        self.data_dir.mkdir(mode=0o700, exist_ok=True)
        self.data_dir.chmod(0o700)

    @classmethod
    def from_env(cls, root: Path = ROOT) -> Settings:
        _load_dotenv(root / ".env")
        env = os.environ
        conf = _read_json(data_root(root) / "config.json")
        api_id = str(conf.get("telegram_api_id") or env.get("TELEGRAM_API_ID", "")).strip()
        saved = _read_json(data_root(root) / "youtrack.json")
        return cls(
            root=root,
            app_origin=env.get("APP_ORIGIN") or f"http://{HOST}:{PORT}",
            telegram_api_id=int(api_id) if api_id.isdigit() else None,
            telegram_api_hash=conf.get("telegram_api_hash") or env.get("TELEGRAM_API_HASH") or None,
            ai_agent_command=env.get("AI_AGENT_COMMAND") or Settings.ai_agent_command,
            ai_model=env["AI_MODEL"].strip() if "AI_MODEL" in env else Settings.ai_model,
            ai_effort=env["AI_EFFORT"].strip() if "AI_EFFORT" in env else Settings.ai_effort,
            ai_agent_project_command=env.get("AI_AGENT_PROJECT_COMMAND") or Settings.ai_agent_project_command,
            ai_task_command=env.get("AI_TASK_COMMAND") or Settings.ai_task_command,
            ai_task_model=env["AI_TASK_MODEL"].strip() if "AI_TASK_MODEL" in env else Settings.ai_task_model,
            ai_task_effort=env["AI_TASK_EFFORT"].strip() if "AI_TASK_EFFORT" in env else Settings.ai_task_effort,
            codex_command=env.get("CODEX_COMMAND") or Settings.codex_command,
            antigravity_command=env.get("ANTIGRAVITY_COMMAND") or Settings.antigravity_command,
            notify=env.get("NOTIFY", "1").strip() != "0",
            done_reaction=env.get("DONE_REACTION", Settings.done_reaction).strip(),
            telegram_me=env.get("TELEGRAM_ME", "").strip(),
            youtrack_url=saved.get("url") or env.get("YOUTRACK_URL") or env.get("YT_URL") or None,
            youtrack_token=saved.get("token") or env.get("YOUTRACK_TOKEN") or env.get("YT_TOKEN") or None,
            youtrack_project=env.get("YOUTRACK_PROJECT") or None,
        )
