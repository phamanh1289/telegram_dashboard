"""A stdio MCP server run behind this filter (`python -m telegram_dashboard.mcp_pin <cmd…>`, provider_cmds.CODEGRAPH):
every tool call's `projectPath` becomes the run's own folder (the server's cwd: the project). codegraph_explore takes
any indexed repo's path, this app's included; pinned, an AI run reads its own project only (SCOPE_RULE)."""

import json
import os
import subprocess
import sys


def pin(line: bytes, project: str) -> bytes:
    """One JSON-RPC line from the client, with each tools/call pinned to `project`; anything else as it came."""
    try:
        msg = json.loads(line)
    except ValueError:
        return line
    for m in msg if isinstance(msg, list) else [msg]:
        call = isinstance(m, dict) and m.get("method") == "tools/call"
        args = (m.get("params") or {}).get("arguments") if call else None
        if isinstance(args, dict) and "projectPath" in args:
            args["projectPath"] = project
    return json.dumps(msg).encode() + b"\n"


def main() -> None:
    project = os.getcwd()
    proc = subprocess.Popen(sys.argv[1:], stdin=subprocess.PIPE)  # its stdout / stderr go straight to the client
    try:
        for line in sys.stdin.buffer:
            proc.stdin.write(pin(line, project))
            proc.stdin.flush()
    except BrokenPipeError:
        pass
    finally:
        proc.stdin.close()
    sys.exit(proc.wait())


if __name__ == "__main__":
    main()
