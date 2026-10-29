// Runs FastAPI (:8765) and Next dev (:3000) together; Ctrl+C stops both.
import { spawn } from "node:child_process";

const env = { ...process.env, APP_ORIGIN: "http://127.0.0.1:3000" };
const procs = [
  spawn("uv", ["run", "--no-sync", "python", "-m", "telegram_dashboard", "serve"], {
    stdio: "inherit",
    env,
  }),
  spawn("npm", ["run", "dev", "-w", "web"], { stdio: "inherit", env }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill("SIGTERM");
  setTimeout(() => {
    for (const p of procs) if (p.exitCode === null) p.kill("SIGKILL");
    process.exit(code);
  }, 3000).unref();
  Promise.all(procs.map((p) => p.exitCode !== null || new Promise((r) => p.once("exit", r)))).then(
    () => process.exit(code),
  );
}

for (const p of procs) p.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
console.log("Mở http://127.0.0.1:3000 (dùng 127.0.0.1, không dùng localhost)");
