"use client";

import { Check, Circle, FileText, Info, Layers, Loader2, TriangleAlert, Workflow } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { AiBot, dur } from "@/shared/components/ai/chat";
import { AiSteps, type TaskEvent } from "@/shared/components/ai/steps";
import { fmtNum, type Key, type T, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

// A UI flow render as it goes (POST /ai/flow streams {"kind": "stage"} steps): how far (%), what is read, drawn and
// checked right now, each stage with its own numbers and time — enough to decide whether to wait or close and come back.

type Stage = "ticket" | "zeplin" | "ai" | "draw" | "link" | "check";
/** One stage step from the server (backend/telegram_dashboard/youtrack/routes.py ai_flow). */
export type FlowStage = {
  kind: "stage"; stage: Stage; at: number; done?: boolean; error?: string; again?: boolean;
  id?: string; chars?: number; stories?: string[]; lost?: string[]; n?: number; of?: number; texts?: number; missing?: number;
  deep?: boolean; screens?: number; title?: string; items?: number; from?: string; item?: string; to?: string; links?: number; dropped?: number;
};
export type FlowEvent = FlowStage | TaskEvent;

const ORDER: Stage[] = ["ticket", "zeplin", "ai", "draw", "link", "check"];
/** The % each stage spans: the AI's reading and writing take most of a run. */
const SPAN: Record<Stage, [number, number]> = { ticket: [0, 6], zeplin: [6, 16], ai: [16, 32], draw: [32, 80], link: [80, 96], check: [96, 100] };
const isStage = (e: FlowEvent): e is FlowStage => e.kind === "stage";
const DRAW = ORDER.indexOf("draw");
const CHIPS_MAX = 12;

/** The run so far: the last step of each stage and when it started; an AI that started over drops what it drew. */
function fold(events: FlowEvent[]) {
  const last: Partial<Record<Stage, FlowStage>> = {};
  const since: Partial<Record<Stage, number>> = {};
  const titles: string[] = [];
  const links: FlowStage[] = [];
  let start: number | undefined;
  for (const e of events) {
    if (!isStage(e)) continue;
    start ??= e.at;
    if (e.stage === "ai" && e.again) { titles.length = links.length = 0; delete last.draw; delete last.link; delete since.draw; delete since.link; }
    since[e.stage] ??= e.at;
    last[e.stage] = e;
    if (e.stage === "draw" && e.title) titles.push(e.title);
    if (e.stage === "link") links.push(e);
  }
  const idx = ORDER.findLastIndex((s) => last[s]);
  return { last, since, titles, links, start, idx, cur: idx < 0 ? undefined : ORDER[idx] };
}
type Run = ReturnType<typeof fold>;

/** How far through `s` (0..1): counts where the server gives them, a slow creep while the AI reads. */
function part(r: Run, s: Stage, now: number): number {
  const e = r.last[s];
  if (!e) return 0;
  if (e.done) return 1;
  switch (s) {
    case "zeplin": return e.of ? (e.n ?? 0) / e.of : 0.5;
    case "ai": return 0.95 * (1 - Math.exp(-(now - e.at) / 45));
    case "draw": return (e.n ?? 0) / Math.max(r.last.ai?.screens ?? 0, (e.n ?? 0) + 1);
    case "link": return (e.n ?? 0) / Math.max(e.items ?? 0, (e.n ?? 0) + 1);
    default: return 0.5;
  }
}

function pct(r: Run, now: number) {
  if (!r.cur) return 0;
  const [lo, hi] = SPAN[r.cur];
  return Math.round(lo + (hi - lo) * Math.min(0.98, part(r, r.cur, now)));
}

const k = (n = 0) => fmtNum(n >= 10_000 ? Math.round(n / 1000) : n) + (n >= 10_000 ? "k" : "");
/** The parts of a line that apply, " · " between them. */
const dot = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" · ");

const NAME: Record<Stage, Key> = {
  ticket: "Đọc ticket", zeplin: "Đọc thiết kế Zeplin", ai: "AI đọc và lên luồng màn", draw: "Vẽ màn", link: "Nối nút với màn đích", check: "Kiểm tra và dựng sơ đồ",
};

/** What a stage read / drew / found, in words ("" before it starts). */
function detail(t: T, r: Run, s: Stage): string {
  const e = r.last[s];
  if (!e) return "";
  const n = e.n ?? 0;
  switch (s) {
    case "ticket":
      if (!e.done) return t("Đang đọc {id} và story cha", { id: e.id ?? "" });
      return dot([e.id, ...(e.stories?.length ? [t("story {ids}", { ids: e.stories.join(", ") })] : [])].join(" + "),
        t("{n} ký tự", { n: k(e.chars) }), !!e.lost?.length && t("không đọc được story {ids}", { ids: e.lost.join(", ") }));
    case "zeplin":
      if (e.error) return e.error;
      if (!e.done) return t("{n}/{of} màn", { n, of: e.of ?? 0 });
      if (!e.of) return t("Ticket không có link Zeplin");
      return dot(t("{n} màn", { n: e.of }), t("{n} có chữ", { n: e.texts ?? 0 }), !!e.missing && t("{n} không đọc được", { n: e.missing }));
    case "ai":
      return dot(e.deep ? t("Model mạnh (Kỹ)") : t("Model nhẹ (Nhanh)"), t("{n} ký tự đầu vào", { n: k(e.chars) }), e.again && t("chạy lại từ đầu"));
    case "draw": {
      const of = r.last.ai?.screens;
      return dot(of && !r.last.link ? t("{n}/~{of} màn", { n, of: Math.max(of, n) }) : t("{n} màn", { n }), t("{n} nút", { n: r.last.link?.items ?? e.items ?? 0 }));
    }
    case "link":
      return r.last.check ? t("{n} liên kết", { n }) : t("{n}/~{of} liên kết", { n, of: Math.max(e.items ?? 0, n) });
    case "check":
      if (!e.done) return t("Đang đọc {n} ký tự AI viết", { n: k(e.chars) });
      return dot(t("{n} màn", { n: e.screens ?? 0 }), t("{n} liên kết", { n: e.links ?? 0 }), !!e.dropped && t("bỏ {n} liên kết hỏng", { n: e.dropped }));
  }
}

/** The one line under the robot: what is happening this second. */
function headline(t: T, r: Run): string {
  const e = r.cur && r.last[r.cur];
  if (!e) return t("Đang bắt đầu…");
  switch (e.stage) {
    case "ticket": return t("Đang đọc ticket {id}", { id: e.id ?? "" });
    case "zeplin": return e.done ? t("Đã đọc thiết kế, gửi cho AI") : t("Đang đọc màn Zeplin {n}/{of}", { n: e.n ?? 0, of: e.of ?? 0 });
    case "ai": return e.again ? t("AI chạy lại từ đầu") : t("AI đang đọc ticket và lên luồng màn");
    case "draw": return t("Đang vẽ màn “{title}”", { title: e.title ?? "" });
    case "link": return e.item ? t("Đang nối “{item}” ({from}) → {to}", { item: e.item, from: e.from ?? "", to: e.to ?? "" }) : t("Đang nối {from} → {to}", { from: e.from ?? "", to: e.to ?? "" });
    case "check": return t("Đang kiểm tra và dựng sơ đồ");
  }
}

/** The render's progress, filling the dialog's body while it runs (the prompt box under it keeps Dừng). */
export function FlowProgress({ events, started, deep }: { events: FlowEvent[]; started: number; deep: boolean }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const i = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(i); }, []);
  // once per event, not per tick (the tick only moves the clock and the AI's creep)
  const r = useMemo(() => fold(events), [events]);
  const tools = useMemo(() => events.filter((e): e is TaskEvent => e.kind === "tool" || e.kind === "tool_result"), [events]);
  const isDeep = r.last.ai?.deep ?? deep; // a run read again: the mode it started with
  // only goes up within a run: each stage stops short of the next one's start, its counts only grow (an AI restart drops back)
  const p = pct(r, now);
  const took = Math.max(0, now - (r.start ?? started));
  const left = r.idx >= DRAW && p >= 35 ? (took * (100 - p)) / p : null; // a guess once the AI writes: its pace so far
  const zeplinErr = r.last.zeplin?.error;
  const lost = !!r.last.ticket?.lost?.length;
  return (
    <div className="@container absolute inset-0 overflow-y-auto">
      <div className="grid min-h-full items-center gap-8 px-4 py-8 @min-[60rem]:grid-cols-[1fr_minmax(0,36rem)_1fr]">
      <Sources r={r} t={t} />
      <div className="mx-auto grid w-full max-w-xl content-center gap-5">
        <div className="grid justify-items-center gap-3 text-center">
          <AiBot className="ai-float size-14 drop-shadow-lg" />
          <p aria-hidden className="ai-text max-w-full truncate text-md font-medium">{headline(t, r)}</p>
          {/* a screen reader hears the stage, not each of the hundreds of screens / links the line names */}
          <p role="status" className="sr-only">{r.cur ? t(NAME[r.cur]) : t("Đang bắt đầu…")}</p>
          <div className="flex w-full items-center gap-3">
            <div role="progressbar" aria-label={t("Tiến trình render")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}
              className="h-2 flex-1 overflow-hidden rounded-full bg-paper-3">
              <div className="h-full rounded-full bg-hl transition-[width] duration-700 ease-out" style={{ width: `${Math.max(2, p)}%` }} />
            </div>
            <span className="w-11 text-right font-mono text-sm tabular-nums text-ink">{p}%</span>
          </div>
          <p className="flex flex-wrap justify-center gap-x-2 text-xs text-ink-3">
            <span>{isDeep ? t("Kỹ") : t("Nhanh")}</span>·<span className="tabular-nums">{t("đã chạy {t}", { t: dur(took) })}</span>
            {left !== null && <>·<span className="tabular-nums">{t("còn khoảng {t}", { t: dur(left) })}</span></>}
          </p>
        </div>

        <ol className="grid grid-cols-1 rounded-xl border border-rule bg-cotton p-1.5">
          {ORDER.map((s, i) => {
            const text = detail(t, r, s);
            const state = i < r.idx || r.last[s]?.done ? "done" : i === r.idx ? "live" : "todo";
            const from = r.since[s], next = ORDER.slice(i + 1).find((n) => r.since[n]);
            const secs = from === undefined ? undefined : (state === "live" || !next ? now : r.since[next]!) - from;
            const warn = (s === "zeplin" && zeplinErr) || (s === "ticket" && lost);
            return (
              <li key={s} aria-current={state === "live" ? "step" : undefined} className={cn("grid gap-1.5 rounded-lg px-2.5 py-2", state === "live" && "ai-ring bg-paper-2")}>
                <div className="flex min-w-0 items-center gap-2.5">
                  {state === "done" ? <Check className="size-4 shrink-0 text-ok" aria-hidden />
                    : state === "live" ? <Loader2 className="size-4 shrink-0 animate-spin text-hl-2" aria-hidden />
                    : <Circle className="size-4 shrink-0 text-ink-3/50" aria-hidden />}
                  <span className={cn("shrink-0 text-sm", state === "todo" ? "text-ink-3" : "text-ink")}>{t(NAME[s])}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-xs", warn ? "text-warn" : "text-ink-2")} title={text}>{text}</span>
                  {secs !== undefined && <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-3">{dur(secs)}</span>}
                </div>
                {s === "draw" && r.titles.length > 0 && (
                  // the last few only: a 60-screen flow would push the robot and bar out of the middle
                  <div className="ml-6.5 flex flex-wrap gap-1">
                    {r.titles.length > CHIPS_MAX && <span className="rounded-md bg-paper-3 px-1.5 py-0.5 text-2xs text-ink-3">+{r.titles.length - CHIPS_MAX}</span>}
                    {r.titles.slice(-CHIPS_MAX).map((x, j, shown) => (
                      <span key={r.titles.length - shown.length + j} className={cn("max-w-48 truncate rounded-md px-1.5 py-0.5 text-2xs animate-in fade-in-0 zoom-in-95",
                        j === shown.length - 1 && state === "live" ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2")}>{x}</span>
                    ))}
                  </div>
                )}
                {s === "link" && r.links.length > 0 && state === "live" && (
                  <ul className="ml-6.5 grid grid-cols-1 gap-0.5 text-2xs text-ink-2">
                    {r.links.slice(-4).map((e) => (
                      <li key={e.n} className="truncate animate-in fade-in-0 slide-in-from-left-1">
                        {e.item ? <>“{e.item}” <span className="text-ink-3">({e.from})</span></> : e.from} → <span className="text-ink">{e.to}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>

        {tools.length > 0 && <div className="max-h-48 overflow-y-auto"><AiSteps items={tools} live={r.cur === "ai"} /></div>}
        {zeplinErr && <p className="flex items-start gap-2 text-xs text-warn"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t("Không đọc được Zeplin: AI chỉ dựa vào ticket, màn vẽ khung đơn giản.")}</p>}
        <p className="flex items-start gap-2 text-xs text-ink-3">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("Có thể đóng cửa sổ: AI vẫn chạy nền, nút \"UI flow\" có chấm báo đang chạy; mở lại để xem tiếp hoặc lấy kết quả. Muốn huỷ: bấm Dừng ở ô dưới.")}
        </p>
      </div>
      <Graph r={r} t={t} />
      </div>
    </div>
  );
}

// ---- side scenes (wide dialog only): what is read on the left, the flow taking shape on the right

const SIDE = "hidden w-52 gap-3 transition-opacity duration-500 @min-[60rem]:grid";
const CHIPS = ["Nút", "Ô nhập", "Ảnh"] as const;

/** Left: the ticket and its stories joined into the Zeplin screens, the screen being read scanned, its parts flying to the AI. */
function Sources({ r, t }: { r: Run; t: T }) {
  const tk = r.last.ticket, z = r.last.zeplin;
  const live = r.idx <= 2; // ticket, Zeplin and the AI's reading: still taking things in
  const of = z?.of ?? 0, n = z?.done ? of : (z?.n ?? 0);
  const files = [tk?.id ?? t("Ticket"), ...(tk?.stories ?? []).map((s) => t("story {ids}", { ids: s }))].slice(0, 3);
  return (
    <div aria-hidden className={cn(SIDE, "justify-self-end", !live && "opacity-60")}>
      <div className="grid gap-1.5">
        {files.map((f, i) => (
          <span key={i} className="flex h-7 items-center gap-1.5 rounded-lg border border-rule bg-cotton px-2 font-mono text-2xs text-ink-2 shadow-stock animate-in fade-in-0 slide-in-from-left-2">
            <FileText className="size-3.5 shrink-0 text-info" /><span className="truncate">{f}</span>
            {tk?.done && <Check className="ml-auto size-3 shrink-0 text-ok" />}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 208 28" className="h-7 w-full" fill="none" strokeLinecap="round">
        {[52, 104, 156].map((x) => <path key={x} d={`M${x} 0C${x} 16 104 12 104 28`} stroke="var(--color-hl-2)" strokeWidth="1.5" className={cn(live && "ai-beam")} opacity={live ? 1 : 0.4} />)}
      </svg>
      <div className="relative mx-auto h-44 w-28">
        <span className="absolute inset-0 -translate-x-3 -rotate-6 rounded-2xl border border-rule bg-paper-2" />
        <span className="absolute inset-0 translate-x-3 rotate-6 rounded-2xl border border-rule bg-paper-2" />
        <div className="absolute inset-0 grid content-start gap-2 overflow-hidden rounded-2xl border border-rule bg-cotton p-2.5 shadow-stock">
          <span className="mx-auto block h-1 w-6 rounded-full bg-ink-3/30" />
          <span className="block h-2 w-3/4 rounded-full bg-ink-3/40" />
          {[0, 1, 2, 3].map((i) => <span key={i} className={cn("block h-4 rounded-md", i === 2 ? "bg-hl/40" : "bg-paper-3")} />)}
          <span className="mt-1 block h-5 rounded-full bg-hl/60" />
          {live && <span className="fx-scan absolute inset-x-0 top-2 h-6 border-b-2 border-hl-2 bg-linear-to-b from-transparent to-hl/25" style={{ "--fx-y": "140px" } as CSSProperties} />}
        </div>
        <span className="absolute -top-2 -left-2 flex h-5 items-center gap-1 rounded-full bg-ink px-1.5 font-mono text-2xs text-cotton shadow-stock">
          <Layers className="size-3" />Zeplin
        </span>
        {live && ["Aa", ...CHIPS.map((c) => t(c))].map((c, k) => (
          <span key={c} className="ai-sample absolute top-0 left-0 inline-flex h-5 items-center rounded-full border border-rule bg-cotton px-1.5 font-mono text-2xs whitespace-nowrap text-ink-2 shadow-stock"
            style={{ offsetPath: `path("M96 ${40 + k * 30}C126 ${40 + k * 30} 136 88 156 88")`, animationDelay: `${k * 0.8}s` }}>{c}</span>
        ))}
      </div>
      {of > 0 && (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap justify-center gap-1">
            {Array.from({ length: Math.min(of, 24) }, (_, i) => (
              <span key={i} className={cn("h-3 w-2 rounded-sm", i < n ? "bg-hl" : i === n && live ? "animate-pulse bg-hl/50" : "bg-paper-3")} />
            ))}
          </div>
          <span className="text-center text-2xs text-ink-3 tabular-nums">{t("{n}/{of} màn", { n, of })}</span>
        </div>
      )}
    </div>
  );
}

/** Right: the screens the AI has drawn so far, the links it made between them; ghosts until the first screen. */
function Graph({ r, t }: { r: Run; t: T }) {
  const live = r.idx >= 2 && r.idx <= 4;
  const shown = r.titles.slice(-8);
  const ghost = shown.length === 0;
  const nodes = ghost ? ["", "", "", ""] : shown;
  const at = (i: number) => [i % 2 ? 140 : 52, 28 + i * 40] as const; // a zigzag down the panel, in the svg's px
  const pos = new Map(nodes.map((s, i) => [s, at(i)]));
  const edges = ghost ? nodes.slice(1).map((_, i) => [at(i), at(i + 1)] as const)
    : r.links.flatMap((e) => { const a = pos.get(e.from ?? ""), b = pos.get(e.to ?? ""); return a && b && a !== b ? [[a, b] as const] : []; });
  const h = 28 + (nodes.length - 1) * 40 + 28;
  return (
    <div aria-hidden className={cn(SIDE, "justify-self-start", r.idx < 2 && "opacity-60")}>
      <span className="flex items-center gap-1.5 text-2xs text-ink-3">
        <Workflow className="size-3.5 text-hl-2" />{t("Luồng màn")}
        {!ghost && <span className="ml-auto tabular-nums">{t("{n} màn", { n: r.titles.length })} · {t("{n} liên kết", { n: r.links.length })}</span>}
      </span>
      <div className="relative w-full" style={{ height: h }}>
        <svg viewBox={`0 0 208 ${h}`} className="absolute inset-0 size-full overflow-visible" fill="none" strokeLinecap="round">
          {edges.map(([[x1, y1], [x2, y2]], i) => (
            <path key={i} d={`M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`}
              stroke={ghost ? "var(--color-ink-3)" : "var(--color-hl-2)"} strokeWidth="1.5" opacity={ghost ? 0.35 : 0.9}
              className={cn(live && "ai-beam", !ghost && "animate-in fade-in-0")} />
          ))}
        </svg>
        {nodes.map((s, i) => {
          const [x, y] = at(i), cur = !ghost && i === nodes.length - 1 && r.idx === 3;
          return (
            <span key={i} style={{ left: x, top: y }}
              className={cn("absolute flex h-7 w-24 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg border px-1.5 text-2xs shadow-stock",
                ghost ? "animate-pulse border-dashed border-rule bg-paper-2" : "border-rule bg-cotton text-ink animate-in fade-in-0 zoom-in-90",
                cur && "border-hl ring-2 ring-hl/30")}>
              <span className={cn("h-4 w-2.5 shrink-0 rounded-sm border", ghost ? "border-ink-3/30" : "border-hl-2 bg-hl/20")} />
              {ghost ? <span className="block h-1.5 w-12 rounded-full bg-ink-3/20" /> : <span className="truncate">{s}</span>}
            </span>
          );
        })}
      </div>
      {ghost && <span className="text-center text-2xs text-ink-3">{t("Chờ AI vẽ màn đầu tiên")}</span>}
    </div>
  );
}

/** The bar under a fresh render: what the AI drew, how long it took, and what it could not read (`warn`: the panel
 *  that said so may never have been seen — the dialog was closed and opened on the finished run). */
export function flowSummary(t: T, events: FlowEvent[]): { text: string; warn: string } {
  const r = fold(events);
  const c = r.last.check;
  if (!c?.done) return { text: "", warn: "" };
  const lost = r.last.ticket?.lost ?? [];
  return {
    text: dot(t("AI vừa vẽ {s} màn, {l} liên kết", { s: c.screens ?? 0, l: c.links ?? 0 }), !!c.dropped && t("bỏ {n} liên kết hỏng", { n: c.dropped }), dur(c.at - (r.start ?? c.at))),
    warn: dot(r.last.zeplin?.error && t("Không đọc được Zeplin: AI chỉ dựa vào ticket, màn vẽ khung đơn giản."), !!lost.length && t("không đọc được story {ids}", { ids: lost.join(", ") })),
  };
}

/** The stage a failed run stopped in, for its error line ("" before any). */
export const flowStage = (t: T, events: FlowEvent[]) => { const c = fold(events).cur; return c ? t(NAME[c]) : ""; };
