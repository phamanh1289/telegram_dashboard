import type { Task } from "@/shared/lib/api";

// A finished Đối chiếu code session read back per topic: the agent's table has one row per topic, "#" = the topic's
// "n" in the prompt's <items>: keyed by its "id" (the topic's first message), else by the title its summary starts with
// (DEEP_BATCH_TASK in backend/telegram_dashboard/ai.py).

export type Verdict = "ok" | "off" | "missing" | "waiting" | "unclear";
const MARKS: [string, Verdict][] = [["✅", "ok"], ["⚠", "off"], ["❌", "missing"], ["⏳", "waiting"], ["❓", "unclear"]];
export const VERDICT_ORDER: Verdict[] = ["missing", "off", "waiting", "unclear", "ok"];
export const VERDICT_EMOJI: Record<Verdict, string> = { ok: "✅", off: "⚠️", missing: "❌", waiting: "⏳", unclear: "❓" };

/** A bulk check (its prompt carries <items>), not a single question / answer one. */
export const isBatch = (t: Pick<Task, "kind" | "prompt">) => t.kind === "deep" && t.prompt.includes("<items>");

/** The status on a table row: the mark that comes first (the status column precedes the evidence, which may quote one). */
function markOf(cells: string): Verdict | undefined {
  let best: [number, Verdict] | undefined;
  for (const [e, v] of MARKS) {
    const i = cells.indexOf(e);
    if (i >= 0 && (!best || i < best[0])) best = [i, v];
  }
  return best?.[1];
}

/** Per topic id (or title), the verdict on its row of a finished bulk check; empty when the answer has no such table. */
export function verdictsOf(t: Pick<Task, "kind" | "prompt" | "result">): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  const m = isBatch(t) && t.result ? /<items>\n([\s\S]*?)\n<\/items>/.exec(t.prompt) : null;
  if (!m) return out;
  let items: { n?: number; id?: string; summary?: string }[];
  try { items = JSON.parse(m[1]); } catch { return out; }
  for (const line of t.result!.split("\n")) {
    const row = /^\|\s*#?(\d+)\s*\|(.*)$/.exec(line.trim());
    const it = row ? items.find((x) => x.n === Number(row[1])) : undefined;
    const title = it?.id || it?.summary?.split("\n")[0];
    const v = row && markOf(row[2]);
    if (title && v && !out.has(title)) out.set(title, v);
  }
  return out;
}
