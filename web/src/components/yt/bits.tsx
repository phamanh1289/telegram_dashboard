"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import { Check, ChevronDown, Copy, MessageSquareText, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, Fragment, use, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AiBot, AiResultCard, AiStop, AiThinking, AiWriting, UserBubble } from "@/components/ai/chat";
import { AiFetching } from "@/components/ai/fetching";
import { Markdown as SharedMarkdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { aiParts, type AiReq, aiReqs, type AiTurn, type Attachment, fileUrl, hue, IMG, initials, PCOL, PLVL, rank, shortName, stateColor, stateSem, typeColor, yt } from "@/lib/yt";
import { ModelEffortPicker } from "@/components/ai";
import { copyText, fold } from "@/lib/inbox";
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
const tagHue = (n: string) => TAG_HUES[[...fold(n)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TAG_HUES.length];
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

/** Button + floating panel (Base UI: closes on outside click and Esc, focus goes back to the button). `title`: a Hint on the button. */
export function Popover({ label, children, className, align = "left", title, chevron = true }: { label: React.ReactNode; children: (close: () => void) => React.ReactNode; className?: string; align?: "left" | "right"; title?: string; chevron?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <BasePopover.Trigger render={<Button size="sm" variant="outline" className={cn("max-w-56 justify-between", className)} />}>
      <span className="truncate">{label}</span>{chevron && <ChevronDown className="text-ink-3" />}
    </BasePopover.Trigger>
  );
  return (
    <BasePopover.Root open={open} onOpenChange={setOpen}>
      {title ? <Hint side="bottom" text={title}>{trigger}</Hint> : trigger}
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={4} align={align === "right" ? "end" : "start"} className="z-40 outline-none">
          <BasePopover.Popup className={POP}>{children(() => setOpen(false))}</BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
/** The floating panel's look, shared with yt/app TeamMenu. */
export const POP = "grid max-h-96 w-72 max-w-[calc(100vw-2rem)] origin-(--transform-origin) overflow-y-auto rounded-md bg-cotton shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

export type PickOpt = { v: string; node: React.ReactNode; text?: string; hint?: string };
/**
 * Pick one value: the trigger shows the current one, the list opens in the top layer (native popover: a scrolling table never clips it).
 * Type to filter (`search`), ↑ ↓ to move, Enter to pick, Esc closes only the list.
 */
export function Picker({ label, title, value, options, onPick, search, foot, disabled, className }: {
  label: React.ReactNode; title: string; value: string; options: PickOpt[]; onPick: (v: string) => void; search?: string; foot?: React.ReactNode; disabled?: boolean; className?: string;
}) {
  const id = useId(), btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [q, setQ] = useState("");
  const shown = q ? options.filter((o) => fold(`${o.text ?? o.v} ${o.v}`).includes(fold(q))) : options;
  const hide = () => { pop.current?.hidePopover(); btn.current?.focus(); };
  const pick = (v: string) => { hide(); if (v !== value) onPick(v); };
  useLayoutEffect(() => { // place it under the trigger (above when there is no room), then focus the search or the current value
    const p = pop.current, b = btn.current;
    if (!open || !p || !b) return;
    const r = b.getBoundingClientRect(), h = p.offsetHeight, up = innerHeight - r.bottom < h + 8 && r.top > h + 8;
    p.style.left = `${Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8))}px`;
    p.style.top = `${up ? r.top - h - 4 : r.bottom + 4}px`;
    (p.querySelector<HTMLElement>("input") ?? p.querySelector<HTMLElement>("[aria-selected=true]") ?? p.querySelector<HTMLElement>("[role=option]"))?.focus();
    const away = (e: Event) => { if (!p.contains(e.target as Node)) p.hidePopover(); }; // it is fixed: scrolling the page would leave it behind
    addEventListener("scroll", away, true);
    return () => removeEventListener("scroll", away, true);
  }, [open]);
  function key(e: React.KeyboardEvent) {
    e.stopPropagation(); // a table row / the sheet must not act on keys meant for the list
    if (e.key === "Escape") { e.preventDefault(); hide(); return; }
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); if (shown[0]) pick(shown[0].v); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...pop.current!.querySelectorAll<HTMLElement>("[role=option]")], k = all.indexOf(document.activeElement as HTMLElement);
    all[k < 0 ? (e.key === "ArrowDown" ? 0 : all.length - 1) : (k + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  }
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <button ref={btn} type="button" popoverTarget={id} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={title}
        className={cn("group inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-sm transition-colors duration-(--dur-micro) hover:bg-paper-3 aria-expanded:bg-paper-3 disabled:cursor-wait disabled:opacity-60", className)}>
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-expanded:opacity-100" />
      </button>
      <div ref={pop} id={id} popover="auto" onKeyDown={key} onToggle={(e) => { setOpen(e.newState === "open"); setQ(""); }}
        className="fixed inset-auto m-0 max-h-80 w-64 overflow-hidden rounded-md border-0 bg-cotton p-0 text-ink shadow-pop">
        {open && (
          <div className="flex max-h-80 flex-col">
            {search && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={search} aria-label={search}
              className="m-2 mb-1 h-8 shrink-0 rounded-md border border-rule bg-paper px-2 text-sm focus:border-hl" />}
            <div role="listbox" aria-label={title} className="grid min-h-0 overflow-y-auto p-1">
              {shown.map((o) => (
                <button key={o.v} type="button" role="option" aria-selected={o.v === value} onClick={() => pick(o.v)}
                  className="flex min-h-8 items-center gap-2 rounded px-2 py-1 text-left text-sm outline-none hover:bg-paper-2 focus-visible:bg-paper-2 aria-selected:font-medium">
                  <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{o.node}</span>
                  {o.hint && <small className="shrink-0 text-xs text-ink-3">{o.hint}</small>}
                  <Check aria-hidden className={cn("size-4 shrink-0 text-hl-2", o.v !== value && "invisible")} />
                </button>
              ))}
              {!shown.length && <p className="px-2 py-1.5 text-sm text-ink-3 italic">Không thấy “{q}”</p>}
            </div>
            {foot && <p className="shrink-0 border-t px-3 py-1.5 text-xs text-ink-3">{foot}</p>}
          </div>
        )}
      </div>
    </span>
  );
}

/** Multi-select with search, used for Sprint / Người / aging states. */
export function MultiSelect({ label, all, options, value, onChange, render = (v) => v, search = true, className, count, swatch }: {
  label: string; all: string; options: string[]; value: string[]; onChange: (v: string[]) => void; render?: (v: string) => React.ReactNode; search?: boolean; className?: string;
  count?: (v: string) => number | undefined; swatch?: (v: string) => string;
}) {
  const [q, setQ] = useState("");
  const shown = value.length === 0 ? all : value.length <= 2 ? value.map((v) => String(render(v))).join(", ") : `${label}: ${value.length} đã chọn`;
  return (
    <Popover label={shown} title={label} className={className}>
      {() => (
        <>
          {search && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm ${label.toLowerCase()}…`} aria-label={`Tìm ${label.toLowerCase()}`}
            className="m-2 mb-1 h-8 rounded-md border border-rule bg-paper px-2 text-sm focus:border-hl" />}
          <div className="grid overflow-y-auto p-1">
            <button type="button" onClick={() => onChange([])} className="rounded px-2 py-1.5 text-left text-xs text-ink-3 hover:bg-paper-2 hover:text-ink">Bỏ chọn tất cả</button>
            {options.filter((o) => !q || fold(o).includes(fold(q))).map((o) => {
              const on = value.includes(o);
              return (
                <button key={o} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-paper-2">
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded-[4px] border", on ? "border-hl bg-hl text-hl-ink" : "border-rule-2")}>{on && <Check className="size-3" />}</span>
                  {swatch && <i aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: swatch(o) }} />}
                  <span className="truncate">{o}</span>
                  {count && <b className="ml-auto font-mono text-xs font-medium text-ink-3 tabular-nums">{(count(o) ?? 0).toLocaleString("vi-VN")}</b>}
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
/** Where YouTrack text's images live: `![](image.png)` names a file of `issue` (the one added with `comment` first). */
export type Files = { issue: string; list: Attachment[]; comment?: string | null };
const YT_IMG = /!\[([^\]]*)\]\(([^)\s]*)[^)]*\)(\{[^}]*\})?/g; // alt, src, YouTrack's {width=…}
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/; // code keeps its text as typed
const unname = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
/** YouTrack markup → markdown the page can show: attachment images through our server, inline <span>/<br> HTML dropped. */
function ytText(text: string, f?: Files) {
  return text.split(CODE).map((part, k) => (k % 2 ? part : part.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(span|font)\b[^>]*>/gi, "")
    .replace(YT_IMG, (_, alt: string, src: string) => {
      if (/^https?:\/\//i.test(src)) return `![${alt}](${src})`;
      const name = unname(src), a = f && (f.list.find((x) => x.name === name && x.comment === (f.comment ?? null)) ?? f.list.find((x) => x.name === name));
      return a && f ? `![${alt || a.name}](${fileUrl(f.issue, a)})` : `[ảnh${name ? `: ${name}` : ""}]`;
    }))).join("");
}

export function Markdown({ text, className, onTicket, files }: { text: string | null | undefined; className?: string; onTicket?: (id: string) => void; files?: Files }) {
  // reading text (descriptions, comments, AI answers): 15px, 1.55, ~70ch a line (DESIGN.md Type); tables keep the full width
  return <SharedMarkdown text={files ? ytText(text ?? "", files) : (text ?? "").replace(IMG, "[ảnh]")} className={cn("text-[0.9375rem] leading-[1.55] [&>:not(table)]:max-w-[70ch]", className)} onTicket={onTicket} />;
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
  return { s, thread, q, canAsk: !!req && thread.length > 0, heavy: heavyReq(req), run, ask, seed, stop, cancel, set: setS };
}

/** Whether a YouTrack AI request runs heavy on the server (yt_dashboard): it reads code, or sends over 10 tickets.
 *  A follow-up runs like its first request. */
export function heavyReq(req: AiReq | null) {
  const j = (req?.json ?? {}) as { folder?: string; ids?: unknown[] };
  return !!j.folder || (req?.path === "/ai/tickets" && (j.ids?.length ?? 0) > 10);
}

/** The model + effort (short) a YouTrack prompt box will run on: the light picks, or the heavy ones (code, many tickets). */
export function YtPicks({ heavy, className }: { heavy: boolean; className?: string }) {
  return (
    <Hint side="bottom" text={`Model và effort cho lượt này: ${heavy ? "Đọc code, nhiều ticket" : "Hỏi AI, báo cáo, soạn ticket"}. Đổi ở đây hoặc Cài đặt › YouTrack › AI và prompt.`}>
      <span className={cn("flex", className)}><ModelEffortPicker kind={heavy ? "yt_task" : "yt"} compact className="gap-x-1.5" /></span>
    </Hint>
  );
}

/** An AI run as a conversation, the AI Agent look: asks in bubbles, answers in result cards, the live turn thinking or
 *  writing. `ids={false}`: ticket IDs stay plain text (in the AI sheet, opening one would replace the answer).
 *  `stop={false}`: no stop button by the live turn (the page's prompt box has its own). */
export function AiBox({ ai, className, onClose, onUse, ids = true, stop = true }: { ai: ReturnType<typeof useAi>; className?: string; onClose?: () => void; onUse?: (text: string) => void; ids?: boolean; stop?: boolean }) {
  const y = useYt();
  const s = ai.s;
  if (s.status === "idle") return null;
  const open = ids ? (id: string) => y.openTicket(id) : undefined;
  const close = () => { ai.cancel(); onClose?.(); };
  const turns = s.status === "done" ? ai.thread.slice(0, -1) : ai.thread; // done: the last turn is drawn below with its actions
  const lastQ = s.status === "done" ? ai.thread.at(-1)?.q : ai.q;
  const closeBtn = <Button size="icon-xs" variant="ghost" aria-label="Đóng" onClick={close}><X /></Button>;
  return (
    <div aria-live="polite" className={cn("grid grid-cols-[minmax(0,1fr)] gap-3", className)}>
      {turns.map((t, k) => (
        <Fragment key={k}>
          {t.q && <UserBubble>{t.q}</UserBubble>}
          <AiResultCard dim><Markdown text={t.a} onTicket={open} /></AiResultCard>
        </Fragment>
      ))}
      {lastQ && <UserBubble>{lastQ}</UserBubble>}
      {s.status === "busy" ? <>
        {s.text?.trim() && <Markdown text={s.text.replace(/\n\s*={3,}\s*(\n|$)/, "\n\n")} className="px-0.5 text-ink animate-in fade-in-0 duration-(--dur-short)" />}
        <div className="flex items-center gap-2">
          {s.text?.trim() ? <AiWriting /> : <AiThinking label={s.label} className="min-w-0 flex-1" />}
          {stop && <span className="ml-auto"><AiStop onClick={ai.stop} label="Hủy" /></span>}
        </div>
      </> : s.status === "error" ? (
        <AiResultCard error actions={closeBtn}>{s.error}</AiResultCard>
      ) : (
        <AiResultCard actions={<>
          {onUse && <Hint side="bottom" text="Đặt vào ô bình luận để sửa rồi gửi lên YouTrack"><Button size="xs" variant="ghost" onClick={() => onUse(s.draft || s.text)}><MessageSquareText /> Đưa vào bình luận</Button></Hint>}
          <Button size="xs" variant="ghost" onClick={() => void copyText(s.text)}><Copy /> Copy</Button>
          {closeBtn}
        </>}>
          <Markdown text={s.text} onTicket={open} />
        </AiResultCard>
      )}
    </div>
  );
}

/** Set by the dashboard: a card there gets an AI button that opens a chat about that one report. */
export const CardAi = createContext<((title: string) => void) | null>(null);

/** The AI entry point: a glinting "AI" chip; hover / focus pops a robot up with a speech bubble. */
export function AiAsk({ label, onClick, hint = "Hỏi mình về số liệu này nhé!", big }: { label: string; onClick: () => void; hint?: string; big?: boolean }) {
  const [peek, setPeek] = useState(false);
  return (
    <button type="button" onClick={onClick} aria-label={label}
      onPointerEnter={() => setPeek(true)} onPointerLeave={() => setPeek(false)} onFocus={() => setPeek(true)} onBlur={() => setPeek(false)}
      className={cn("ai-chip yt-noprint relative inline-flex shrink-0 items-center gap-1 rounded-full font-semibold", big ? "h-7 px-3 text-xs" : "h-6 px-2 text-[11px]")}>
      <AnimatePresence>
        {peek && (
          // big (sticky nav, under the header): drops below, right-aligned; on a card: pops up over the title
          <motion.span key="bot" initial={{ opacity: 0, y: big ? -10 : 10, scale: 0.5 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: big ? -8 : 8, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 520, damping: 22 }}
            className={cn("pointer-events-none absolute z-30 flex gap-1", big ? "top-full right-0 mt-1.5 origin-top-right flex-row-reverse items-start" : "bottom-full right-0 mb-1 origin-bottom-right flex-row-reverse items-end")}>
            <AiBot className="size-8 drop-shadow-sm" />
            <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 }}
              className={cn("rounded-lg bg-cotton px-2 py-1 text-[11px] font-medium whitespace-nowrap text-ink shadow-pop", big ? "mt-4 rounded-tr-none" : "mb-4 rounded-br-none")}>{hint}</motion.span>
          </motion.span>
        )}
      </AnimatePresence>
      <Sparkles className={big ? "size-3.5" : "size-3"} aria-hidden />{big ? "Hỏi AI tổng quan" : "AI"}
    </button>
  );
}

/** A dashboard / home card. */
export function Card({ title, meta, children, className, onMeta }: { title: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode; className?: string; onMeta?: () => void }) {
  const ai = use(CardAi);
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
      className={cn("yt-card grid min-w-0 grid-cols-1 content-start gap-3 rounded-[var(--radius-card)] bg-cotton p-4 shadow-stock transition-shadow duration-(--dur-short) hover:shadow-pop", className)}>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <div className="ml-auto flex items-center gap-2">
          {meta && (onMeta ? <button type="button" onClick={onMeta} className="text-xs text-ink-3 hover:text-ink">{meta}</button> : <span className="text-xs text-ink-3">{meta}</span>)}
          {ai && typeof title === "string" && <AiAsk label={`Hỏi AI về ${title}`} onClick={() => ai(title)} />}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

/** Section label inside a card / sheet: a step smaller, quiet, sentence case (never uppercase, DESIGN.md). */
export const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h4 className={cn("flex items-center gap-1.5 text-xs font-semibold text-ink-3", className)}>{children}</h4>
);

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

/** Waiting on YouTrack: the feature's AI scene (tickets: first load / a scope not warmed yet, release, people), with this project's ticket IDs. */
export function YtFetching({ kind = "tickets", className }: { kind?: "tickets" | "release" | "people"; className?: string }) {
  return <AiFetching kind={kind} project={useYt().project} className={className} />;
}
