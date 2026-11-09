"use client";

import { Bug, Check, CheckCircle2, CircleAlert, Code, ListChecks, Loader2, type LucideIcon, PenLine, ScrollText, Square } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

// The AI chat look every AI feature shares (AI Agent, Trợ lý AI of a tag, YouTrack AI): the ask in a bubble, the AI
// thinking / writing, the result card, the prompt box pinned under the feed. A new AI feature builds from these.

/** Seconds as "0.8s", "42s", "3m 05s". */
export function dur(s: number) {
  if (s < 10) return `${Math.max(0, s).toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

/** A little robot head: blinking eyes, a glowing antenna, an arm that waves while it is shown. */
export const AiBot = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 32 32" aria-hidden className={className}>
    <line x1="16" y1="3.5" x2="16" y2="8" stroke="var(--color-hl-2)" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="16" cy="3.2" r="2" fill="var(--color-hl)" className="ai-glow" />
    <rect x="3.5" y="13" width="2.5" height="6" rx="1.25" fill="var(--color-hl-2)" />
    <rect x="26" y="13" width="2.5" height="6" rx="1.25" fill="var(--color-hl-2)" />
    <rect x="6" y="8" width="20" height="16" rx="6" fill="var(--color-hl)" />
    <rect x="9" y="11.5" width="14" height="8.5" rx="4.25" fill="var(--color-cotton)" />
    <g className="ai-blink"><circle cx="13" cy="15.5" r="1.6" fill="var(--color-hl-2)" /><circle cx="19" cy="15.5" r="1.6" fill="var(--color-hl-2)" /></g>
    <path d="M14.2 18.2q1.8 1.2 3.6 0" stroke="var(--color-hl-2)" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    <rect x="11" y="25" width="10" height="6" rx="2.5" fill="var(--color-hl-2)" />
    <path d="M26 27.5q3-1 3.5-5" stroke="var(--color-hl-2)" strokeWidth="2" fill="none" strokeLinecap="round" className="ai-wave" />
  </svg>
);

/** Three dots in a wave (still under reduced motion). */
export const AiDots = ({ className }: { className?: string }) => (
  <span className={cn("flex shrink-0 gap-1", className)} aria-hidden>
    {[0, 150, 300].map((d) => <span key={d} className="ai-dot size-1.5 rounded-full bg-hl" style={{ animationDelay: `${d}ms` }} />)}
  </span>
);

/** 0…n-1, the next every `ms`. */
function useTick(n: number, ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setI((k) => (k + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms]);
  return n ? i % n : 0;
}

/** One of `lines`, the next every `ms`. */
function useRotate(lines: string[] | undefined, ms: number) {
  const i = useTick(lines?.length ?? 0, ms);
  return lines?.length ? lines[i] : undefined;
}

/** Waiting on the first word: the hopping robot and a shimmering status line; `lines` rotate every 2.2s. */
export function AiThinking({ label = "AI đang suy nghĩ", lines, className }: { label?: string; lines?: string[]; className?: string }) {
  const text = useRotate(lines, 2200) ?? label;
  return (
    <div role="status" className={cn("flex items-center gap-2.5 px-0.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)", className)}>
      <AiBot className="ai-hop size-7 shrink-0 drop-shadow-sm" />
      <span key={text} className="ai-text min-w-0 truncate text-sm font-medium animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">{text}</span>
      <AiDots />
    </div>
  );
}

/** A line being written: grows from the left after `d` ms. */
const Bar = ({ w, d = 0, className }: { w: string; d?: number; className?: string }) => (
  <span className={cn("sk-grow block h-1.5 shrink-0 rounded-full bg-rule-2", className)} style={{ width: w, animationDelay: `${d}ms` }} />
);
const pop = (d: number) => ({ animationDelay: `${d}ms` });

export type AiSkill = "summary" | "steps" | "reply" | "ticket" | "code";

/** What the assistant can do, each with a tiny scene of its result being written (replays every time it comes round). */
const SKILLS: Record<AiSkill, { icon: LucideIcon; label: string; scene: ReactNode }> = {
  summary: { icon: ScrollText, label: "Tóm tắt ý chính", scene: (
    <ul className="grid gap-2">
      {([["92%", "bg-hl/70"], ["68%", ""], ["80%", ""]] as const).map(([w, c], i) => (
        <li key={i} className="flex items-center gap-2"><span className="sk-pop size-1.5 shrink-0 rounded-full bg-hl" style={pop(i * 220)} /><Bar w={w} d={i * 220 + 80} className={c} /></li>
      ))}
    </ul>
  ) },
  steps: { icon: ListChecks, label: "Gợi ý bước tiếp theo", scene: (
    <ul className="grid gap-2">
      {["76%", "60%", "84%"].map((w, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className="grid size-3.5 shrink-0 place-items-center rounded-[4px] border border-rule-2"><Check className="sk-pop size-3 text-ok" style={pop(350 + i * 380)} /></span>
          <Bar w={w} d={i * 380} />
        </li>
      ))}
    </ul>
  ) },
  reply: { icon: PenLine, label: "Soạn sẵn mẫu trả lời", scene: (
    <div className="grid justify-items-end gap-2">
      <div className="sk-pop grid w-4/5 origin-bottom-right gap-1.5 rounded-2xl rounded-br-sm bg-hl-wash px-3 py-2">
        <Bar w="100%" d={250} className="bg-hl/60" />
        <span className="flex items-center gap-0.5"><Bar w="55%" d={650} className="bg-hl/60" /><span className="sk-caret h-2.5 w-px bg-hl-2" /></span>
      </div>
      <span className="flex gap-1">{[0, 1, 2].map((k) => <span key={k} className="sk-pop h-1 w-4 rounded-full bg-hl/50" style={pop(1000 + k * 160)} />)}</span>
    </div>
  ) },
  ticket: { icon: Bug, label: "Soạn ticket YouTrack", scene: (
    <div className="grid gap-2">
      <span className="flex items-center gap-2"><span className="sk-pop rounded-sm bg-paper-3 px-1 font-mono text-[0.625rem] leading-4 text-ink-2">APP-128</span><Bar w="55%" d={200} className="bg-ink-3/60" /></span>
      <Bar w="90%" d={420} />
      <span className="flex gap-1.5 text-[0.625rem] leading-4">
        <span className="sk-pop rounded-full bg-error-wash px-1.5 text-error" style={pop(750)}>Bug</span>
        <span className="sk-pop rounded-full bg-warn-wash px-1.5 text-warn" style={pop(900)}>High</span>
        <span className="sk-pop rounded-full bg-paper-3 px-1.5 text-ink-2" style={pop(1050)}>@bạn</span>
      </span>
    </div>
  ) },
  code: { icon: Code, label: "Giao AI Agent đọc code", scene: (
    <div className="grid gap-1.5 rounded-md bg-paper-2 p-2">
      {([[["16%", "bg-hl/70"], ["38%", "bg-info/60"]], [["8%", ""], ["30%", "bg-ok/60"], ["20%", ""]], [["8%", ""], ["44%", "bg-ink-3/50"]]] as const).map((row, i) => (
        <span key={i} className="flex gap-1">{row.map(([w, c], j) => <Bar key={j} w={w} d={i * 300 + j * 120} className={c} />)}</span>
      ))}
    </div>
  ) },
};

const STAGE = 192; // px; the skills sit on a ring of radius R around the robot
const R = 74;

/** An AI panel with nothing asked yet: the robot works through `skills` one by one, leaning to the one in hand and
 *  beaming to it, while a small card under it writes out that skill's kind of result. */
export function AiIdle({ skills, className }: { skills: AiSkill[]; className?: string }) {
  const i = useTick(skills.length, 2800);
  const at = (k: number) => { const a = (k / skills.length) * 2 * Math.PI - Math.PI / 2; return [Math.cos(a), Math.sin(a)] as const; };
  const [cx, cy] = at(i);
  const c = STAGE / 2;
  const cur = SKILLS[skills[i]];
  const Icon = cur.icon;
  return (
    <div className={cn("grid place-content-center justify-items-center gap-4 py-6 animate-in fade-in-0 zoom-in-95 duration-(--dur-long)", className)}>
      <div aria-hidden className="relative" style={{ width: STAGE, height: STAGE }}>
        <span className="ai-halo absolute inset-12 rounded-full bg-hl/30 blur-2xl" />
        <span className="absolute rounded-full border border-dashed border-rule-2" style={{ inset: c - R }} />
        <svg viewBox={`0 0 ${STAGE} ${STAGE}`} className="absolute inset-0 overflow-visible">
          <line key={i} x1={c + cx * 34} y1={c + cy * 34} x2={c + cx * (R - 21)} y2={c + cy * (R - 21)}
            stroke="var(--color-hl)" strokeWidth="2" strokeLinecap="round" className="ai-beam animate-in fade-in-0 duration-(--dur-short)" />
        </svg>
        <span key={`p${i}`} className="ai-packet absolute size-2 rounded-full bg-hl shadow-[0_0_8px_var(--color-hl)]"
          style={{ left: c - 4, top: c - 4, "--dx": `${cx * (R - 20)}px`, "--dy": `${cy * (R - 20)}px` } as CSSProperties} />
        {skills.map((s, k) => {
          const [x, y] = at(k);
          const SkillIcon = SKILLS[s].icon;
          return (
            <span key={s} style={{ left: c + x * R - 18, top: c + y * R - 18 }}
              className={cn("absolute grid size-9 place-items-center rounded-full border transition-[background-color,color,border-color,scale,box-shadow] duration-(--dur-short) ease-(--ease-out)",
                k === i ? "scale-115 border-hl bg-hl text-hl-ink shadow-[0_0_0_5px_color-mix(in_oklch,var(--color-hl)_18%,transparent)]" : "border-rule bg-cotton text-ink-3")}>
              <SkillIcon className="size-4" />
            </span>
          );
        })}
        {/* leans toward the skill in hand */}
        <span className="absolute inset-0 grid place-items-center transition-[translate,rotate] duration-500 ease-(--ease-out)"
          style={{ translate: `${cx * 5}px ${cy * 5}px`, rotate: `${cx * 8}deg` }}>
          <AiBot className="ai-float size-16 drop-shadow-lg" />
        </span>
        <span className="ai-shadow absolute h-1.5 w-10 rounded-full bg-ink-3/40 blur-[2px]" style={{ left: c - 20, top: c + 38 }} />
      </div>
      <figure key={i} className="grid w-64 max-w-full gap-2.5 rounded-xl border border-rule bg-cotton p-3 shadow-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)">
        <figcaption className="flex items-center gap-1.5 text-xs font-medium text-hl-2"><Icon className="size-3.5" aria-hidden />{cur.label}</figcaption>
        <div aria-hidden>{cur.scene}</div>
      </figure>
      <span aria-hidden className="flex gap-1">
        {skills.map((s, k) => <span key={s} className={cn("h-1 rounded-full transition-[width,background-color] duration-(--dur-short)", k === i ? "w-4 bg-hl" : "w-1 bg-rule-2")} />)}
      </span>
    </div>
  );
}

/** Under text that is still streaming in. */
export const AiWriting = ({ label = "AI đang viết" }: { label?: string }) => (
  <p role="status" className="flex items-center gap-2 px-0.5 text-xs"><span className="ai-text font-medium">{label}</span><AiDots /></p>
);

/** What the user asked, right-aligned. */
export function UserBubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex justify-end animate-in fade-in-0 slide-in-from-bottom-2 zoom-in-95 duration-(--dur-short)", className)}>
      <div className="max-w-[85%] origin-bottom-right whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-hl-wash px-3.5 py-2 text-sm leading-[1.55] text-ink">
        {children}
      </div>
    </div>
  );
}

/** A finished answer (green, "Kết quả") or a failed one (red, "Có lỗi"); `took` in seconds, `dim` for an older turn. */
export function AiResultCard({ children, error, title, took, actions, dim, className, ...rest }: {
  children: ReactNode; error?: boolean; title?: ReactNode; took?: number; actions?: ReactNode; dim?: boolean; className?: string; "aria-label"?: string;
}) {
  return (
    <div {...rest} role={error ? "alert" : undefined}
      className={cn("rounded-xl border p-3.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-long)",
        error ? "border-error/25 bg-error-wash" : "border-ok/25 bg-ok-wash", dim && "opacity-75", className)}>
      <p className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold", error ? "text-error" : "text-ok")}>
        {error ? <CircleAlert className="size-4" aria-hidden /> : <CheckCircle2 className="size-4 animate-in zoom-in-50 spin-in-45 duration-(--dur-long)" aria-hidden />}
        {title ?? (error ? "Có lỗi" : "Kết quả")}
        {took !== undefined && <span className="ml-auto font-mono font-normal tabular-nums text-ink-3">{dur(took)}</span>}
      </p>
      <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 break-words text-sm leading-[1.55]", error ? "text-error" : "text-ink-2")}>{children}</div>
      {actions && <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1">{actions}</div>}
    </div>
  );
}

/** Round stop button with a spinning rim, shown while the AI runs. */
export function AiStop({ onClick, busy, label = "Dừng", hint = "Dừng AI" }: { onClick: () => void; busy?: boolean; label?: string; hint?: string }) {
  return (
    <Hint text={hint} side="bottom">
      <button type="button" aria-label={label} aria-busy={busy} disabled={busy} onClick={onClick}
        className="relative grid size-8 shrink-0 place-items-center rounded-full bg-error-wash text-error transition-[scale,background-color] duration-(--dur-micro) hover:scale-105 hover:bg-error hover:text-cotton active:scale-95 disabled:opacity-60 animate-in zoom-in-50 fade-in-0 duration-(--dur-short)">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-error/20 border-t-error motion-reduce:animate-none" aria-hidden />
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Square className="size-3 fill-current" aria-hidden />}
      </button>
    </Hint>
  );
}

/**
 * The prompt box: one rounded field, the ring orbits while the AI runs. Enter sends, Shift+Enter breaks the line,
 * ⌘/Ctrl+Enter calls `onModEnter` when given. `top`: chips / attachments above the text; `tools`: left of the bottom
 * row (model picker…); `actions`: right of it (picker, send / queue), then the stop button while `running`.
 * A plain div, never a form: it may sit inside another form (the reply).
 */
export function AiPromptBox({ value, onChange, onSend, onModEnter, running, onStop, stopping, stopHint, stopLabel, top, tools, actions, className, ...field }: {
  value: string; onChange: (v: string) => void; onSend: () => void; onModEnter?: () => void;
  running?: boolean; onStop?: () => void; stopping?: boolean; stopHint?: string; stopLabel?: string;
  top?: ReactNode; tools?: ReactNode; actions?: ReactNode; className?: string;
  id?: string; "aria-label": string; placeholder?: string; maxLength?: number; autoFocus?: boolean;
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
}) {
  return (
    <div className={cn("rounded-2xl border border-rule-2 bg-cotton shadow-stock transition-[border-color,box-shadow] duration-(--dur-short) focus-within:border-ink-3",
      running && "ai-ring", className)}>
      {top && <div className="relative px-3 pt-3">{top}</div>}
      <textarea {...field} rows={2} value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if ((e.metaKey || e.ctrlKey) && onModEnter) onModEnter();
          else onSend();
        }}
        className="relative block max-h-48 min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-ink outline-none field-sizing-content placeholder:text-ink-3" />
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-2.5 pb-2.5 text-xs text-ink-2">
        {tools}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {actions}
          {running && onStop && <AiStop onClick={onStop} busy={stopping} hint={stopHint} label={stopLabel} />}
        </div>
      </div>
    </div>
  );
}

/** Keeps a scrolling feed at its bottom as `trigger` changes (content arrives), unless the reader scrolled up; a change of
 *  `reset` (a new ask) follows again. */
export function useFollow(trigger: unknown, reset?: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => { stick.current = true; }, [reset]); // before the scroll below: effects run in order
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [trigger, reset]);
  return {
    ref,
    onScroll: (e: React.UIEvent<HTMLElement>) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; },
  };
}
