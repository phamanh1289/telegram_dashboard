"use client";

import { ChevronDown, FilePlus, FileText, FolderSearch, Globe, ListChecks, Loader2, type LucideIcon, Pencil, Search, SquareTerminal, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { AiBotIcon, dur } from "@/components/ai/chat";
import { type Key, t, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// The AI's working steps (read a file, search, run a command), folded into one live block: AI Agent, Đối chiếu BE and
// YouTrack AI with code all show their steps this way.

/** One line of an AI run: the prompt, a tool call ("<name>  <input>") and its output, text, the result. */
export type TaskEvent = { kind: string; text: string; error?: boolean; at?: number; cost?: number; code?: string }; // cost: a result turn, USD as the CLI estimates; code: a Trợ lý AI turn read this project
/** Tool name -> icon, a verb and its "doing" form, so a step reads "Đọc SellProgressCard.kt", live "Đang đọc …". */
const TOOLS: Record<string, [LucideIcon, Key, Key]> = {
  Read: [FileText, "Đọc", "Đang đọc"], Edit: [Pencil, "Sửa", "Đang sửa"], MultiEdit: [Pencil, "Sửa", "Đang sửa"], Write: [FilePlus, "Tạo", "Đang tạo"],
  Bash: [SquareTerminal, "Chạy", "Đang chạy"], Grep: [Search, "Tìm", "Đang tìm"], Glob: [FolderSearch, "Tìm file", "Đang tìm file"],
  WebFetch: [Globe, "Mở web", "Đang mở web"], WebSearch: [Globe, "Tìm web", "Đang tìm web"], Task: [AiBotIcon, "Gọi agent", "Đang gọi agent"],
  Agent: [AiBotIcon, "Gọi agent", "Đang gọi agent"], TodoWrite: [ListChecks, "Lập kế hoạch", "Đang lập kế hoạch"],
};
/** Icon, verb, "doing" line, in the current language (call from a component that uses `useT`, so it follows a switch). */
export const toolMeta = (name: string): [LucideIcon, string, string] => {
  const m = TOOLS[name];
  return m ? [m[0], t(m[1]), t(m[2])] : [Wrench, name, t("Đang {verb}", { verb: name })];
};

type Step = { name: string; arg: string; at?: number; out?: TaskEvent };
/** took / tools: seconds the turn ran and spent in tools (logs from before timestamps have neither). */
export type Block = { kind: "tools"; steps: Step[] } | { kind: "event"; ev: TaskEvent; took?: number; tools?: number };
const stepSecs = (s: Step) => (s.at && s.out?.at ? s.out.at - s.at : undefined);

/** Folds consecutive tool calls and their outputs into one block; parallel calls get their outputs back in order. */
export function groupEvents(items: TaskEvent[]): Block[] {
  const out: Block[] = [];
  let waiting: Step[] = [];
  let shown = new Set<string>(); // assistant texts of the current turn
  let start: number | undefined; // when the current turn was sent
  let tools = 0;
  for (const ev of items) {
    if (ev.kind === "user") { shown = new Set(); start = ev.at; tools = 0; }
    if (ev.kind === "assistant" && ev.text?.trim()) shown.add(ev.text.trim());
    if (ev.kind === "result" && ev.text?.trim()) { // the final answer already streamed as text: show it once, in the result box
      const res = ev.text.trim();
      const n = out.length;
      for (let b = out.at(-1); b?.kind === "event" && b.ev.kind === "assistant" && b.ev.text.trim() && res.includes(b.ev.text.trim()); b = out.at(-1)) out.pop();
      if (out.length === n && shown.has(res)) continue; // a late result (background agents) repeating an earlier text
    }
    if (ev.kind === "result") {
      const took = start && ev.at ? ev.at - start : undefined;
      out.push({ kind: "event", ev, took, tools: took === undefined ? undefined : Math.min(tools, took) }); // parallel calls overlap
      continue;
    }
    if (ev.kind !== "tool" && ev.kind !== "tool_result") { out.push({ kind: "event", ev }); continue; }
    let last = out.at(-1);
    if (last?.kind !== "tools") { last = { kind: "tools", steps: [] }; out.push(last); waiting = []; }
    if (ev.kind === "tool") {
      const [name, ...rest] = ev.text.split("  "); // "<name>  <input>" from the backend
      const step: Step = { name, arg: rest.join("  "), at: ev.at };
      last.steps.push(step);
      waiting.push(step);
    } else {
      const s = waiting.shift();
      if (s) { s.out = ev; tools += stepSecs(s) ?? 0; }
    }
  }
  return out;
}

/** A path shows as its file name, the folder muted and the full path on hover. */
function StepArg({ arg }: { arg: string }) {
  if (!arg.startsWith("/")) return <span className="min-w-0 truncate font-mono text-xs text-ink-2" title={arg}>{arg}</span>;
  const cut = arg.lastIndexOf("/");
  return (
    <span className="min-w-0 truncate text-xs" title={arg}>
      <span className="font-medium text-ink">{arg.slice(cut + 1)}</span>
      <span className="ml-1.5 text-ink-3">{arg.slice(0, cut).split("/").slice(-2).join("/")}</span>
    </span>
  );
}

function StepRow({ s, live }: { s: Step; live: boolean }) {
  useT(); // re-render on a language switch (toolMeta)
  const [open, setOpen] = useState(false);
  const [Icon, verb] = toolMeta(s.name);
  const err = s.out?.error;
  const secs = stepSecs(s);
  return (
    <li className="animate-in fade-in-0 slide-in-from-left-1 duration-(--dur-short)">
      <button type="button" disabled={!s.out?.text} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-(--dur-micro) enabled:hover:bg-paper-2">
        {live ? <Loader2 className="size-3.5 shrink-0 animate-spin text-hl-2" aria-hidden />
          : <Icon className={cn("size-3.5 shrink-0", err ? "text-error" : "text-ink-3")} aria-hidden />}
        <span className={cn("w-14 shrink-0 truncate text-xs", err ? "text-error" : "text-ink-2")}>{verb}</span>
        <StepArg arg={s.arg} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <span className="rounded-sm bg-paper-2 px-1 font-mono text-2xs leading-4 text-ink-3">{s.name}</span>
          {secs !== undefined && <span className="w-11 text-right font-mono text-2xs tabular-nums text-ink-3">{dur(secs)}</span>}
          {s.out?.text && <ChevronDown className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden />}
        </span>
      </button>
      {open && s.out && (
        <pre className={cn("mt-1 mb-1.5 ml-7 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 font-mono text-2xs leading-relaxed animate-in fade-in-0 duration-(--dur-short)",
          err ? "bg-error-wash text-error" : "bg-paper-2 text-ink-2")}>{s.out.text}</pre>
      )}
    </li>
  );
}

/** A run of tool steps: one summary line ("Đọc 5, Tìm 2", 1m 12s), the steps behind it. While live it stays open on the current step. */
export function ToolGroup({ steps, live }: { steps: Step[]; live: boolean }) {
  const t = useT();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? live;
  const counts = new Map<string, number>();
  for (const s of steps) { const v = toolMeta(s.name)[1]; counts.set(v, (counts.get(v) ?? 0) + 1); }
  const current = steps.at(-1)!;
  const errors = steps.filter((s) => s.out?.error).length;
  const first = steps[0].at, end = steps.findLast((s) => s.out?.at)?.out?.at;
  return (
    <div className={cn("rounded-xl border border-rule bg-cotton transition-shadow duration-(--dur-short)", live && "ai-ring")}>
      <button type="button" aria-expanded={open} onClick={() => setToggled(!open)}
        className="relative flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-ink-2 transition-colors duration-(--dur-micro) hover:text-ink">
        {live ? <Loader2 className="size-3.5 shrink-0 animate-spin text-hl-2" aria-hidden /> : <Wrench className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
        {live ? (
          <span className="flex min-w-0 items-center gap-1.5"><span className="ai-text shrink-0 font-medium">{toolMeta(current.name)[2]}</span><StepArg arg={current.arg} /></span>
        ) : (
          <span className="truncate">{[...counts].map(([v, n]) => `${v} ${n}`).join(", ")}</span>
        )}
        {errors > 0 && <span className="shrink-0 rounded-sm bg-error-wash px-1.5 text-error">{t("{n} lỗi", { n: errors })}</span>}
        <span className="ml-auto flex shrink-0 gap-2 font-mono tabular-nums text-ink-3">
          <span>{t("{n} bước", { n: steps.length })}</span>{!live && first && end ? <span>{dur(end - first)}</span> : null}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden />
      </button>
      {open && (
        <ul className="relative grid grid-cols-[minmax(0,1fr)] border-t border-rule px-1.5 py-1.5 animate-in fade-in-0 duration-(--dur-short)">
          {steps.map((s, i) => <StepRow key={i} s={s} live={live && i === steps.length - 1 && !s.out} />)}
        </ul>
      )}
    </div>
  );
}

/** A run's working steps as it streams them (no log around them): each run of tools as one ToolGroup. */
export function AiSteps({ items, live = false }: { items?: TaskEvent[]; live?: boolean }) {
  const blocks = useMemo(() => groupEvents(items ?? []), [items]);
  return blocks.map((b, i) => b.kind === "tools" && <ToolGroup key={i} steps={b.steps} live={live && i === blocks.length - 1} />);
}
