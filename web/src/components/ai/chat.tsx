"use client";

import { CheckCircle2, CircleAlert, Loader2, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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

/** Waiting on the first word: the hopping robot and a shimmering status line; `lines` rotate every 2.2s. */
export function AiThinking({ label = "AI đang suy nghĩ", lines, className }: { label?: string; lines?: string[]; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!lines?.length) return;
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 2200);
    return () => clearInterval(t);
  }, [lines]);
  const text = lines?.length ? lines[i % lines.length] : label;
  return (
    <div role="status" className={cn("flex items-center gap-2.5 px-0.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)", className)}>
      <AiBot className="ai-hop size-7 shrink-0 drop-shadow-sm" />
      <span key={text} className="ai-text min-w-0 truncate text-sm font-medium animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">{text}</span>
      <AiDots />
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
