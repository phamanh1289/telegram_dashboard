"use client";

import { Check, ChevronDown, Copy, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { copyText, hue, initials, md, norm, PCOL, PLVL, rank, shortName, stateColor, stateSem, typeColor } from "@/lib/yt";

// Small pieces every YouTrack view uses.

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <b aria-hidden className={cn("inline-grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-ink-2", className)}
      style={{ background: `oklch(var(--av-l) var(--av-c) ${hue(name)})` }}>{initials(name)}</b>
  );
}

export function Person({ name, empty = "—" }: { name: string | null; empty?: string }) {
  if (!name) return <span className="text-ink-3">{empty}</span>;
  return <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={name}><Avatar name={name} /><span className="truncate">{shortName(name)}</span></span>;
}

export function StatePill({ state }: { state: string | null }) {
  const sem = stateSem(state);
  return (
    <span aria-label={`Trạng thái: ${state || "—"}`} className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-ink-2",
      sem && "rounded-[var(--radius-input)] px-1.5 leading-[22px]", sem === "ok" && "bg-ok-wash text-ok", sem === "bad" && "bg-error-wash text-error")}>
      <i className="size-2 shrink-0 rounded-[2px]" style={{ background: stateColor(state) }} />{state || "—"}
    </span>
  );
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
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-2", type === "Bug" && "font-semibold text-error")}>
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
export function Popover({ label, children, className, align = "left", title }: { label: React.ReactNode; children: (close: () => void) => React.ReactNode; className?: string; align?: "left" | "right"; title?: string }) {
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
        <span className="truncate">{label}</span><ChevronDown className="text-ink-3" />
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.13 }}
            className={cn("absolute top-full z-40 mt-1 grid max-h-80 w-64 overflow-hidden rounded-md bg-cotton shadow-pop", align === "right" ? "right-0" : "left-0")}>
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Multi-select with search, used for Sprint / Người / aging states. */
export function MultiSelect({ label, all, options, value, onChange, render = (v) => v, search = true }: {
  label: string; all: string; options: string[]; value: string[]; onChange: (v: string[]) => void; render?: (v: string) => React.ReactNode; search?: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = value.length === 0 ? all : value.length <= 2 ? value.map((v) => String(render(v))).join(", ") : `${label}: ${value.length} đã chọn`;
  return (
    <Popover label={shown} title={label}>
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

export function Markdown({ text, className }: { text: string | null | undefined; className?: string }) {
  return <div className={cn("text-sm leading-relaxed break-words [&_a]:text-hl-2 [&_a]:underline [&_code]:rounded [&_code]:bg-code-wash [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.8125rem]", className)}
    dangerouslySetInnerHTML={{ __html: md(text) }} />;
}

// ---------- AI ----------
export type AiRun = { label: string; run: (signal: AbortSignal) => Promise<{ text: string; draft?: string }> };
type AiState = { status: "idle" } | { status: "busy"; label: string } | { status: "done"; text: string; draft?: string } | { status: "error"; error: string };

/** One AI run at a time per box: busy line with Hủy, then the answer with Copy. Aborts on unmount / new run. */
export function useAi() {
  const [s, setS] = useState<AiState>({ status: "idle" });
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  async function run(r: AiRun) {
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setS({ status: "busy", label: r.label });
    try {
      const out = await r.run(c.signal);
      if (c === ctl.current) setS({ status: "done", text: out.text || "(trống)", draft: out.draft });
      return out;
    } catch (e) {
      if (c === ctl.current && (e as Error).name !== "AbortError") setS({ status: "error", error: (e as Error).message });
    }
  }
  const cancel = () => { ctl.current?.abort(); ctl.current = null; setS({ status: "idle" }); };
  return { s, run, cancel, set: setS };
}

export function AiBox({ ai, className, onClose }: { ai: ReturnType<typeof useAi>; className?: string; onClose?: () => void }) {
  const s = ai.s;
  if (s.status === "idle") return null;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} aria-live="polite"
      className={cn("relative rounded-lg border border-hl/30 bg-hl-wash/40 p-3 text-sm", s.status === "error" && "border-error/30 bg-error-wash", className)}>
      {s.status === "busy" ? (
        <div className="flex items-center gap-2 text-ink-2">
          <Sparkles className="size-4 animate-pulse text-hl-2" aria-hidden /><span>{s.label}…</span>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={ai.cancel}>Hủy</Button>
        </div>
      ) : s.status === "error" ? (
        <div className="flex items-start gap-2 text-error"><span className="flex-1">{s.error}</span>
          <Button size="icon-xs" variant="ghost" aria-label="Đóng" onClick={() => { ai.cancel(); onClose?.(); }}><X /></Button></div>
      ) : (
        <>
          <Markdown text={s.text} />
          <div className="mt-2 flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => { void copyText(s.text); toast({ text: "Đã copy" }); }}><Copy /> Copy</Button>
            <Button size="icon-xs" variant="ghost" aria-label="Đóng" onClick={() => { ai.cancel(); onClose?.(); }}><X /></Button>
          </div>
        </>
      )}
    </motion.div>
  );
}

/** A dashboard / home card. */
export function Card({ title, meta, children, className, onMeta }: { title: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode; className?: string; onMeta?: () => void }) {
  return (
    <section className={cn("grid min-w-0 content-start gap-3 rounded-[var(--radius-card)] bg-cotton p-4 shadow-stock", className)}>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <h3 className="text-[0.8125rem] font-semibold">{title}</h3>
        {meta && (onMeta ? <button type="button" onClick={onMeta} className="text-xs text-ink-3 hover:text-ink">{meta}</button> : <span className="text-xs text-ink-3">{meta}</span>)}
      </div>
      {children}
    </section>
  );
}
