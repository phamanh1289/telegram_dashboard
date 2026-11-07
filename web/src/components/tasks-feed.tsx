"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ExternalLink, FilePlus, FileText, FolderSearch, Globe, ListChecks, Loader2, type LucideIcon, Paperclip, Pencil, Search, SquareTerminal, Wrench } from "lucide-react";
import { createContext, memo, use, useState } from "react";
import { AiResultCard, dur, UserBubble } from "@/components/ai/chat";
import { Markdown } from "@/components/markdown";
import { Hint } from "@/components/ui/hint";
import { type Attached, chatByTitle, parseAttachments, splitAttachments } from "@/lib/attach";
import { cn } from "@/lib/utils";

// An AI Agent session's conversation: the log's events folded into turns, tool runs and results.

export type TaskEvent = { kind: string; text: string; error?: boolean; at?: number };
export type TaskLog = { items: TaskEvent[]; next: number; running?: boolean };

/** Tool name -> icon and a Vietnamese verb, so a step reads "Đọc SellProgressCard.kt". */
const TOOLS: Record<string, [LucideIcon, string]> = {
  Read: [FileText, "Đọc"], Edit: [Pencil, "Sửa"], MultiEdit: [Pencil, "Sửa"], Write: [FilePlus, "Tạo"],
  Bash: [SquareTerminal, "Chạy"], Grep: [Search, "Tìm"], Glob: [FolderSearch, "Tìm file"],
  WebFetch: [Globe, "Mở web"], WebSearch: [Globe, "Tìm web"], Task: [Bot, "Gọi agent"], Agent: [Bot, "Gọi agent"],
  TodoWrite: [ListChecks, "Lập kế hoạch"],
};
const toolMeta = (name: string): [LucideIcon, string] => TOOLS[name] ?? [Wrench, name];

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
          <span className="rounded-sm bg-paper-2 px-1 font-mono text-[0.625rem] leading-4 text-ink-3">{s.name}</span>
          {secs !== undefined && <span className="w-11 text-right font-mono text-[0.6875rem] tabular-nums text-ink-3">{dur(secs)}</span>}
          {s.out?.text && <ChevronDown className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden />}
        </span>
      </button>
      {open && s.out && (
        <pre className={cn("mt-1 mb-1.5 ml-7 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 font-mono text-[0.6875rem] leading-relaxed animate-in fade-in-0 duration-(--dur-short)",
          err ? "bg-error-wash text-error" : "bg-paper-2 text-ink-2")}>{s.out.text}</pre>
      )}
    </li>
  );
}

/** A run of tool steps: one summary line ("Đọc 5, Tìm 2", 1m 12s), the steps behind it. While live it stays open on the current step. */
export function ToolGroup({ steps, live }: { steps: Step[]; live: boolean }) {
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
          <span className="flex min-w-0 items-center gap-1.5"><span className="ai-text shrink-0 font-medium">Đang {toolMeta(current.name)[1].toLowerCase()}</span><StepArg arg={current.arg} /></span>
        ) : (
          <span className="truncate">{[...counts].map(([v, n]) => `${v} ${n}`).join(", ")}</span>
        )}
        {errors > 0 && <span className="shrink-0 rounded-sm bg-error-wash px-1.5 text-error">{errors} lỗi</span>}
        <span className="ml-auto flex shrink-0 gap-2 font-mono tabular-nums text-ink-3">
          <span>{steps.length} bước</span>{!live && first && end ? <span>{dur(end - first)}</span> : null}
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

/** Where a turn's time went: tools vs the model thinking/writing, as one bar. */
function TurnTimeline({ took, tools }: { took: number; tools: number }) {
  const pct = took > 0 ? (tools / took) * 100 : 0;
  return (
    <div className="mt-3 grid gap-1.5 border-t border-ok/20 pt-2.5 text-[0.6875rem] text-ink-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-paper-3" aria-hidden>
        <span className="h-full origin-left bg-warn/80 animate-in slide-in-from-left-full duration-(--dur-long)" style={{ width: `${pct}%` }} />
        <span className="h-full flex-1 bg-hl/70" />
      </div>
      <p className="flex flex-wrap gap-x-3 font-mono tabular-nums">
        <span>Tổng {dur(took)}</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-warn/80" aria-hidden />Công cụ {dur(tools)}</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-hl/70" aria-hidden />Suy nghĩ {dur(took - tools)}</span>
      </p>
    </div>
  );
}

const AI_TEXT = "text-[0.9375rem] leading-[1.6]";

/** Opens a message in its group (AI Agent: the session's group is `home`, attached messages of others name it by title). */
export const OpenAttached = createContext<{ home: string | null; open: (chatId: string, messageId: string) => void } | null>(null);

/** One attached message: who, when, which group if not the session's, its text; ↗ opens it in the group. */
function AttachedCard({ a }: { a: Attached }) {
  const ctx = use(OpenAttached);
  const qc = useQueryClient();
  const chat = a.id ? (a.group ? chatByTitle(qc, a.group) : ctx?.home) : null;
  return (
    <li className="grid gap-1 rounded-lg border border-rule bg-cotton px-2.5 py-2">
      {a.id && (
        <p className="flex min-w-0 items-center gap-1.5 text-ink-3">
          <span className="shrink-0 font-mono tabular-nums">#{a.id}</span>
          <span className="truncate font-medium text-ink-2">{a.who}</span>
          <span className="shrink-0">{a.when}</span>
          {a.group && <span className="truncate rounded-sm bg-paper-2 px-1">{a.group}</span>}
          {a.media && <span className="shrink-0 rounded-sm bg-paper-2 px-1">{a.media}</span>}
          {ctx && chat && (
            <Hint side="bottom" text="Mở tin này trong nhóm Telegram">
              <button type="button" aria-label={`Mở tin #${a.id} trong nhóm`} onClick={() => ctx.open(chat, a.id)}
                className="-my-1 ml-auto grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
                <ExternalLink className="size-3.5" aria-hidden />
              </button>
            </Hint>
          )}
        </p>
      )}
      <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-ink">{a.body}</p>
    </li>
  );
}

/** A prompt the user sent; attached messages fold under it, one card each. */
function UserTurn({ text }: { text: string }) {
  const [said, attached] = splitAttachments(text);
  const items = attached ? parseAttachments(attached) : [];
  return (
    <UserBubble className={AI_TEXT}>
      {said && <p>{said}</p>}
      {items.length > 0 && (
        <details className={cn("whitespace-normal text-xs text-ink-2", said && "mt-1.5")}>
          <summary className="inline-flex cursor-pointer items-center gap-1 rounded-sm hover:text-ink"><Paperclip className="size-3" aria-hidden /> {items.length} tin đính kèm</summary>
          <ul className="mt-1.5 grid gap-1.5">{items.map((a, i) => <AttachedCard key={a.id || i} a={a} />)}</ul>
        </details>
      )}
    </UserBubble>
  );
}

/** One turn's text, prompt or result. Memoised on the event itself (the log keeps old event objects while it grows), so
 *  the 1.5s poll doesn't re-parse every Markdown block of the session. */
export const EventItem = memo(function EventItem({ ev, took, tools }: { ev: TaskEvent; took?: number; tools?: number }) {
  if (ev.kind === "user") return <li><UserTurn text={ev.text} /></li>;
  if (ev.kind === "result") {
    return (
      <li>
        <AiResultCard error={ev.error} className="p-4">
          {ev.text && <Markdown asks text={ev.text} className={cn(AI_TEXT, "text-ink")} />}
          {took !== undefined && <TurnTimeline took={took} tools={tools ?? 0} />}
        </AiResultCard>
      </li>
    );
  }
  return <li className={cn("px-0.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)", ev.error ? "text-error" : "text-ink")}><Markdown asks text={ev.text} className={AI_TEXT} /></li>;
});
