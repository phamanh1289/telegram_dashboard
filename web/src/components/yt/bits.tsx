"use client";

import { Check, ChevronDown, Copy, MessageSquareText, SendHorizontal, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, use, useEffect, useRef, useState } from "react";
import { Markdown as SharedMarkdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { aiParts, type AiReq, aiReqs, type AiTurn, copyText, hue, IMG, initials, norm, PCOL, PLVL, rank, shortName, stateColor, stateSem, typeColor, yt } from "@/lib/yt";
import { useYt } from "./state";

// Small pieces every YouTrack view uses.

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <b aria-hidden className={cn("inline-grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-ink-2", className)}
      style={{ background: `oklch(var(--av-l) var(--av-c) ${hue(name)})` }}>{initials(name)}</b>
  );
}

export function Person({ name, empty = "—" }: { name: string | null; empty?: string }) {
  if (!name) return <span className="text-ink-3">{empty}</span>;
  return <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={name}><Avatar name={name} /><span className="truncate">{shortName(name)}</span></span>;
}

/** State as a chip tinted with its workflow tier colour (the swatch keeps it readable without colour too). */
export function StatePill({ state }: { state: string | null }) {
  const sem = stateSem(state), c = stateColor(state);
  return (
    <span aria-label={`Trạng thái: ${state || "—"}`} style={{ background: `color-mix(in oklch, ${c} 15%, transparent)` }}
      className={cn("inline-flex items-center gap-1.5 rounded-[var(--radius-input)] px-1.5 text-xs leading-[22px] font-medium whitespace-nowrap text-ink",
        sem === "ok" && "text-ok", sem === "bad" && "text-error")}>
      <i className="size-2 shrink-0 rounded-[2px]" style={{ background: c }} />{state || "—"}
    </span>
  );
}

/** A [module] tag from the title: a fixed hue per name, so the same module reads the same everywhere. */
const TAG_HUES = [185, 225, 255, 285, 315, 345]; // teal → magenta: six apart, none of them a state's red / amber / green
const tagHue = (n: string) => TAG_HUES[[...norm(n)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TAG_HUES.length];
export function Tag({ name }: { name: string }) {
  return <span className="rounded-[4px] px-1.5 text-xs leading-[18px] font-medium text-ink" style={{ background: `oklch(var(--av-l) calc(var(--av-c) * 2) ${tagHue(name)})` }}>{name}</span>;
}

export function Prio({ p }: { p: string | null }) {
  if (!p || !PCOL[p]) return <span className="text-ink-3">—</span>;
  const hi = rank({ priority: p }) < 3;
  return (
    <span aria-label={`${p} ưu tiên`} className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-ink-2", hi && "font-semibold")} style={hi ? { color: PCOL[p] } : undefined}>
      <span aria-hidden className="inline-flex h-3 items-end gap-0.5">
        {[5, 7, 10, 12].map((h, k) => <i key={h} className="w-[3px] rounded-[1px]" style={{ height: h, background: k < PLVL[p] ? "currentColor" : "var(--color-rule-2)" }} />)}
      </span>{p}
    </span>
  );
}

export function TypeTag({ type }: { type: string | null }) {
  if (type === "Bug") return <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] bg-error-wash px-1.5 text-xs leading-[22px] font-semibold whitespace-nowrap text-error"><i className="size-1.5 rounded-full bg-error" />Bug</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-2">
      <i className="size-1.5 rounded-full" style={{ background: typeColor(type) }} />{type || "—"}
    </span>
  );
}

/** Toggle chip with a colour swatch and a count, as in the State / Priority / Type rows. */
export function Chip({ on, onClick, swatch, children, count, title }: { on: boolean; onClick: () => void; swatch?: string; children: React.ReactNode; count?: number; title?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors duration-(--dur-micro)",
        on ? "border-hl bg-hl text-hl-ink" : "border-rule bg-cotton text-ink-2 hover:border-rule-2 hover:text-ink")}>
      {swatch && <i className="size-2 shrink-0 rounded-[2px]" style={{ background: swatch }} />}
      {children}
      {count != null && <b className={cn("font-mono font-medium tabular-nums", on ? "text-hl-ink/80" : "text-ink-3")}>{count.toLocaleString("vi-VN")}</b>}
    </button>
  );
}

/** Button + floating panel; closes on outside click and Esc. */
export function Popover({ label, children, className, align = "left", title, chevron = true }: { label: React.ReactNode; children: (close: () => void) => React.ReactNode; className?: string; align?: "left" | "right"; title?: string; chevron?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key, true); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" aria-expanded={open} title={title} onClick={() => setOpen(!open)} className={cn("max-w-56 justify-between", className)}>
        <span className="truncate">{label}</span>{chevron && <ChevronDown className="text-ink-3" />}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.13 }}
            className={cn("absolute top-full z-40 mt-1 grid max-h-96 w-72 overflow-y-auto rounded-md bg-cotton shadow-pop", align === "right" ? "right-0" : "left-0")}>
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Multi-select with search, used for Sprint / Người / aging states. */
export function MultiSelect({ label, all, options, value, onChange, render = (v) => v, search = true, className }: {
  label: string; all: string; options: string[]; value: string[]; onChange: (v: string[]) => void; render?: (v: string) => React.ReactNode; search?: boolean; className?: string;
}) {
  const [q, setQ] = useState("");
  const shown = value.length === 0 ? all : value.length <= 2 ? value.map((v) => String(render(v))).join(", ") : `${label}: ${value.length} đã chọn`;
  return (
    <Popover label={shown} title={label} className={className}>
      {() => (
        <>
          {search && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm ${label.toLowerCase()}…`} aria-label={`Tìm ${label.toLowerCase()}`}
            className="m-2 mb-1 h-8 rounded-md border border-rule bg-paper px-2 text-sm outline-none focus:border-hl" />}
          <div className="grid overflow-y-auto p-1">
            <button type="button" onClick={() => onChange([])} className="rounded px-2 py-1.5 text-left text-xs text-ink-3 hover:bg-paper-2 hover:text-ink">Bỏ chọn tất cả</button>
            {options.filter((o) => !q || norm(o).includes(norm(q))).map((o) => {
              const on = value.includes(o);
              return (
                <button key={o} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-paper-2">
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded-[4px] border", on ? "border-hl bg-hl text-hl-ink" : "border-rule-2")}>{on && <Check className="size-3" />}</span>
                  <span className="truncate">{o}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Popover>
  );
}

/** `onTicket`: ticket IDs in the text become buttons that open the ticket (AI answers: "VA-12: ping Lan"). */
export function Markdown({ text, className, onTicket }: { text: string | null | undefined; className?: string; onTicket?: (id: string) => void }) {
  // reading text (descriptions, comments, AI answers): 15px, 1.55, ~70ch a line (DESIGN.md Type); tables keep the full width
  return <SharedMarkdown text={(text ?? "").replace(IMG, "[ảnh]")} className={cn("text-[0.9375rem] leading-[1.55] [&>:not(table)]:max-w-[70ch]", className)} onTicket={onTicket} />;
}

// ---------- AI ----------
export type AiRun = { label: string; q?: string; run: (signal: AbortSignal) => Promise<{ text: string; draft?: string }> };
type AiState = { status: "idle" } | { status: "busy"; label: string; text?: string } | { status: "done"; text: string; draft?: string } | { status: "error"; error: string };

/** One AI run at a time per box: busy line with Hủy, then the answer with Copy. Aborts on unmount / new run.
 *  After an answer, `ask` sends a follow-up: the first request again (same data) + the thread so far + the question.
 *  `onTurn`: each answered turn (`first`: a new conversation), for the history. */
export function useAi(onTurn?: (req: AiReq | null, thread: AiTurn[], first: boolean) => void) {
  const [s, setS] = useState<AiState>({ status: "idle" });
  const [thread, setThread] = useState<AiTurn[]>([]); // finished turns; when done, the last one is `s.text`
  const [q, setQ] = useState(""); // the follow-up being answered (busy / error)
  const [req, setReq] = useState<AiReq | null>(null); // the first request, sent again with each follow-up
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  async function start(label: string, run: AiRun["run"], ask: string, first = false) {
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setQ(ask);
    setS({ status: "busy", label });
    aiParts.set(c.signal, (text) => { if (c === ctl.current) setS({ status: "busy", label, text }); });
    try {
      const out = await run(c.signal);
      if (c === ctl.current) {
        const text = out.text || "(trống)";
        const r = first ? aiReqs.get(c.signal) ?? null : req;
        const next = [...(first ? [] : thread), { q: ask, a: text }];
        setReq(r);
        setThread(next);
        setQ("");
        setS({ status: "done", text, draft: out.draft });
        onTurn?.(r, next, first);
        return { ...out, req: r };
      }
    } catch (e) {
      if (c === ctl.current && (e as Error).name !== "AbortError") setS({ status: "error", error: (e as Error).message });
    }
  }
  const run = (r: AiRun) => { setReq(null); setThread([]); return start(r.label, r.run, r.q ?? "", true); }; // `q`: the user's own prompt, shown above the answer
  const ask = (text: string) => {
    const r = req, h = thread;
    if (r && h.length) return start("AI đang trả lời", (sig) => yt.aiFollow(r, h, text, sig), text);
  };
  /** Show a saved exchange as if just run, so it can be followed up (`r`: its request, if kept). */
  const seed = (t: AiTurn[], r: AiReq | null) => {
    const last = t.at(-1);
    if (!last) return;
    ctl.current?.abort(); setReq(r); setThread(t); setQ(""); setS({ status: "done", text: last.a });
  };
  /** Hủy: a follow-up goes back to the last answer, a first run to nothing. */
  const stop = () => {
    ctl.current?.abort(); ctl.current = null; setQ("");
    const last = thread.at(-1);
    setS(last ? { status: "done", text: last.a } : { status: "idle" });
  };
  const cancel = () => { ctl.current?.abort(); ctl.current = null; setReq(null); setThread([]); setQ(""); setS({ status: "idle" }); };
  return { s, thread, q, canAsk: !!req && thread.length > 0, run, ask, seed, stop, cancel, set: setS };
}

const AskLine = ({ q }: { q: string }) => (
  <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-paper-3 px-2.5 py-1.5 whitespace-pre-wrap text-ink">{q}</p>
);

/** The follow-up box under an answer. Enter sends, Shift+Enter breaks the line (not while an IME is composing). */
function AskBox({ ai }: { ai: ReturnType<typeof useAi> }) {
  const [text, setText] = useState("");
  const send = () => { const t = text.trim(); if (!t) return; setText(""); void ai.ask(t); };
  return (
    <form className="mt-2 flex items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <Textarea rows={1} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Hỏi tiếp AI"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        placeholder="Hỏi tiếp, vd. viết ngắn hơn, dịch sang tiếng Anh, chi tiết VA-12…" className="min-h-9 resize-none bg-cotton text-sm" />
      <Button type="submit" size="icon-sm" aria-label="Gửi" disabled={!text.trim()}><SendHorizontal /></Button>
    </form>
  );
}

/** `ids={false}`: ticket IDs stay plain text (in the AI sheet, opening one would replace the answer). */
/** `ask={false}`: no follow-up box inside (the page has its own composer). */
export function AiBox({ ai, className, onClose, onUse, ids = true, ask = true }: { ai: ReturnType<typeof useAi>; className?: string; onClose?: () => void; onUse?: (text: string) => void; ids?: boolean; ask?: boolean }) {
  const y = useYt();
  const s = ai.s;
  if (s.status === "idle") return null;
  const open = ids ? (id: string) => y.openTicket(id) : undefined;
  const close = () => { ai.cancel(); onClose?.(); };
  const turns = s.status === "done" ? ai.thread.slice(0, -1) : ai.thread; // done: the last turn is drawn below with its actions
  const lastQ = s.status === "done" ? ai.thread.at(-1)?.q : ai.q;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} aria-live="polite"
      className={cn("relative grid gap-2 rounded-lg border border-hl/30 bg-hl-wash/40 p-3 text-sm", s.status === "error" && !ai.thread.length && "border-error/30 bg-error-wash", className)}>
      {turns.map((t, k) => (
        <div key={k} className="grid gap-2 border-b border-rule pb-2">
          {t.q && <AskLine q={t.q} />}
          <Markdown text={t.a} onTicket={open} />
        </div>
      ))}
      {lastQ && <AskLine q={lastQ} />}
      {s.status === "busy" ? (
        <div>
          <div className="flex items-center gap-2 text-ink-2">
            <Sparkles className="size-4 animate-pulse text-hl-2" aria-hidden /><span>{s.label}…</span>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={ai.stop}>Hủy</Button>
          </div>
          {s.text?.trim() && <Markdown text={s.text.replace(/\n\s*={3,}\s*(\n|$)/, "\n\n")} className="mt-2 text-ink-2" />}
        </div>
      ) : s.status === "error" ? (
        <div>
          <div className="flex items-start gap-2 text-error"><span className="flex-1">{s.error}</span>
            <Button size="icon-xs" variant="ghost" aria-label="Đóng" onClick={close}><X /></Button></div>
          {ask && ai.canAsk && <AskBox ai={ai} />}
        </div>
      ) : (
        <div>
          <Markdown text={s.text} onTicket={open} />
          <div className="mt-2 flex justify-end gap-1">
            {onUse && <Button size="xs" variant="ghost" title="Đặt vào ô bình luận để sửa rồi gửi lên YouTrack" onClick={() => onUse(s.draft || s.text)}><MessageSquareText /> Đưa vào bình luận</Button>}
            <Button size="xs" variant="ghost" onClick={() => void copyText(s.text)}><Copy /> Copy</Button>
            <Button size="icon-xs" variant="ghost" aria-label="Đóng" onClick={close}><X /></Button>
          </div>
          {ask && ai.canAsk && <AskBox ai={ai} />}
        </div>
      )}
    </motion.div>
  );
}

/** Set by the dashboard: a card there gets an AI button that opens a chat about that one report. */
export const CardAi = createContext<((title: string) => void) | null>(null);

/** A dashboard / home card. */
export function Card({ title, meta, children, className, onMeta }: { title: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode; className?: string; onMeta?: () => void }) {
  const ai = use(CardAi);
  return (
    <section className={cn("grid min-w-0 content-start gap-3 rounded-[var(--radius-card)] bg-cotton p-4 shadow-stock", className)}>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-ink">{title}
          {ai && typeof title === "string" && <button type="button" onClick={() => ai(title)} aria-label={`Hỏi AI về ${title}`} title="Hỏi AI sâu hơn về báo cáo này"
            className="yt-noprint grid size-6 place-items-center rounded text-ink-3 hover:bg-paper-2 hover:text-hl-2"><Sparkles className="size-3.5" /></button>}
        </h3>
        {meta && (onMeta ? <button type="button" onClick={onMeta} className="text-xs text-ink-3 hover:text-ink">{meta}</button> : <span className="text-xs text-ink-3">{meta}</span>)}
      </div>
      {children}
    </section>
  );
}

/** Section label inside a card / sheet: a step smaller, quiet, sentence case (never uppercase, DESIGN.md). */
export const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h4 className={cn("flex items-center gap-1.5 text-xs font-semibold text-ink-3", className)}>{children}</h4>
);

/** Segmented control (2–5 options): a groove with the chosen stop raised. */
export function Seg<T extends string>({ value, options, onChange, label, className }: { value: T; options: readonly (readonly [T, React.ReactNode, string?])[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex gap-0.5 rounded-[var(--radius-card)] bg-paper-3 p-0.5 shadow-groove", className)}>
      {options.map(([v, l, title]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} title={title} onClick={() => onChange(v)}
          className={cn("inline-flex h-7 items-center justify-center gap-1.5 rounded-[var(--radius-input)] px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-(--dur-micro) [&_svg]:size-3.5",
            value === v ? "bg-cotton text-ink shadow-edge" : "text-ink-3 hover:text-ink")}>{l}</button>
      ))}
    </div>
  );
}

/** A button that opens a short list of actions (AI ▾, Hiển thị ▾). */
export function Menu({ label, items, align = "left", title, className }: {
  label: React.ReactNode; title?: string; align?: "left" | "right"; className?: string;
  items: ({ label: React.ReactNode; hint?: string; on: () => void; disabled?: boolean } | null)[];
}) {
  return (
    <Popover label={label} title={title} align={align} className={className}>
      {(close) => (
        <div role="menu" className="grid p-1">
          {items.filter((x) => !!x).map((x, k) => (
            <button key={k} type="button" role="menuitem" disabled={x.disabled} onClick={() => { close(); x.on(); }}
              className="grid gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-paper-2 disabled:pointer-events-none disabled:opacity-50">
              <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-ink-3">{x.label}</span>
              {x.hint && <span className="text-xs text-ink-3">{x.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
