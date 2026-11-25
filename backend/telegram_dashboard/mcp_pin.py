"""Start a user's stdio MCP server away from the project (`python -I mcp_pin.py --cwd DIR [--env FILE] <cmd…>`,
provider_cmds._away): from the project, npx would take the project's .npmrc / node_modules (an edit turn may have
written them) as its registry or its code. FILE (JSON, 0600): the server's secrets, added to its env only, never the
AI CLI's (every sandboxed command the AI runs inherits that). The server talks to the CLI over the stdio it inherits."""

import json
import os
import subprocess
import sys

USAGE = "usage: mcp_pin.py --cwd DIR [--env FILE] <command> [args…]"


def main() -> None:
    args = sys.argv[1:]
    if args[:1] != ["--cwd"] or len(args) < 3:
        sys.exit(USAGE)
    cwd, rest, env = args[1], args[2:], None
    if rest[:1] == ["--env"]:
        if len(rest) < 3:
            sys.exit(USAGE)
        with open(rest[1]) as f:
            env = {**os.environ, **{str(k): str(v) for k, v in json.load(f).items()}}
        rest = rest[2:]
    sys.exit(subprocess.call(rest, cwd=cwd, env=env))


if __name__ == "__main__":
    main()
