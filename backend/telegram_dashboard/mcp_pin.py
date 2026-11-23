"""Start a user's stdio MCP server away from the project (`python -I mcp_pin.py --cwd DIR <cmd…>`, provider_cmds._away):
from the project, npx would take the project's .npmrc / node_modules (an edit turn may have written them) as its
registry or its code. The server talks to the CLI over the stdio it inherits."""

import subprocess
import sys


def main() -> None:
    args = sys.argv[1:]
    if args[:1] != ["--cwd"] or len(args) < 3:
        sys.exit("usage: mcp_pin.py --cwd DIR <command> [args…]")
    sys.exit(subprocess.call(args[2:], cwd=args[1]))


if __name__ == "__main__":
    main()
