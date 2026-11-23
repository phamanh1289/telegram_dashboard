#!/usr/bin/env node
// `npx telegram-dashboard [start|update|open]`: installs Radar with the same script as the curl / irm command
// (copied in at prepack: signed release zip, same folder, same in-app updater), then starts it through the installed
// `myradar` command. Nothing runs from node_modules, so `npm update` never touches the app or its data.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const win = process.platform === "win32";
const cmd = process.argv[2] ?? "start";
if (!["start", "update", "open"].includes(cmd)) quit("Dùng: telegram-dashboard [start | update | open]", 2);
if (!win && process.platform !== "darwin") quit("Radar chỉ có bản macOS (Apple Silicon) và Windows x64.");

const dir = win ? join(process.env.LOCALAPPDATA ?? "", "Programs", "Telegram Dashboard") : null;
const myradar = win ? join(dir, "myradar.cmd") : join(homedir(), ".local", "bin", "myradar");

if (cmd === "update" || !existsSync(myradar)) {
  if (cmd === "open") quit("Radar chưa được cài: chạy `npx telegram-dashboard` trước.");
  run(...(win
    ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "install-windows.ps1")]]
    : ["bash", [join(here, "install-macos.sh")]])); // the installer opens the app itself
} else {
  run(...(win ? ["cmd.exe", ["/d", "/c", "myradar.cmd", cmd], { cwd: dir }] : [myradar, [cmd]]));
}

function run(file, args, opts = {}) {
  const r = spawnSync(file, args, { stdio: "inherit", ...opts });
  if (r.error) quit(`Không chạy được ${file}: ${r.error.message}`);
  process.exit(r.status ?? 1);
}

function quit(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}
