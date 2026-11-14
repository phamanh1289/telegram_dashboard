"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { Hint } from "@/shared/components/ui/hint";
import { api, errorText, statusQuery } from "@/shared/lib/api";
import { type Key, t as tPlain, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";

/** The building blocks every settings group shares: cards, rows, switches, status lines and the server reads. */

export function useStatus() {
  // No event stream on this page: poll until Telegram settles, so "Đang kết nối…" turns into the result by itself.
  return useQuery({ ...statusQuery, refetchInterval: (q) => (q.state.data?.state === "connected" ? false : 2000) });
}

/** A settings card: title (+ the long explanation behind the bulb), an optional action on the right, then its rows.
 *  `advanced`: rarely changed; folded to its title until opened, so the everyday settings come first. `title` (the key) is
 *  also the search's scroll anchor (`data-card`), the same in both languages. */
export function Card({ title, info, action, advanced, children }: { title: Key; info?: Key; action?: React.ReactNode; advanced?: boolean; children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(!advanced);
  return (
    <section aria-label={t(title)} data-card={title} className="grid scroll-mt-24 rounded-[var(--radius-card)] border border-rule bg-cotton shadow-stock outline-offset-2 data-flash:outline-2 data-flash:outline-hl">
      <header className={cn("flex min-h-11 items-center gap-1.5 px-4 pt-3 sm:px-5", !open && "pb-3")}>
        {advanced ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-sm text-sm font-bold text-ink">
            <ChevronDown className={cn("size-4 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out)", !open && "-rotate-90")} aria-hidden />
            <h3>{t(title)}</h3>
            <span className="rounded-full bg-paper-2 px-1.5 text-2xs font-medium text-ink-3">{t("Nâng cao")}</span>
          </button>
        ) : <h3 className="text-sm font-bold text-ink">{t(title)}</h3>}
        {info && <InfoHint title={t(title)} text={t(info)} />}
        {action && open && <span className="ml-auto flex items-center gap-2">{action}</span>}
      </header>
      {open && <div className="grid divide-y divide-rule px-4 pb-4 sm:px-5 animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short) ease-(--ease-out) motion-reduce:animate-none">{children}</div>}
    </section>
  );
}

function InfoHint({ title, text }: { title: string; text: string }) {
  const t = useT();
  return (
    <Hint side="bottom" title={title} text={text}>
      <button type="button" aria-label={t("Giải thích: {title}", { title })} className="grid size-6 place-items-center rounded-full text-ink-3 transition-colors duration-(--dur-micro) hover:bg-paper-2 hover:text-ink">
        <Info className="size-3.5" aria-hidden />
      </button>
    </Hint>
  );
}

/** One setting: name and a short line on the left, its control on the right (`stack`: the control below, full width). */
export function Row({ label, desc, children, stack, htmlFor }: { label: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode; stack?: boolean; htmlFor?: string }) {
  const Name = htmlFor ? "label" : "span";
  return (
    <div className={cn("grid gap-2.5 py-3 first:pt-1 last:pb-0", !stack && "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6")}>
      <span className="grid gap-0.5">
        <Name htmlFor={htmlFor} className="text-sm font-medium text-ink">{label}</Name>
        {desc && <span className="text-xs leading-relaxed text-ink-3">{desc}</span>}
      </span>
      {children !== undefined && <div className={cn("min-w-0", !stack && "sm:justify-self-end")}>{children}</div>}
    </div>
  );
}

/** A status line with a coloured dot (the word carries the meaning, the dot only repeats it). */
export function StatusLine({ tone, children }: { tone: "ok" | "warn" | "idle" | "error"; children: React.ReactNode }) {
  const dot = { ok: "bg-ok", warn: "bg-signal", idle: "bg-ink-3 animate-pulse", error: "bg-error" }[tone];
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
      <span className={cn("min-w-0", tone === "ok" ? "text-ink" : tone === "error" ? "text-error" : tone === "warn" ? "text-signal-2" : "text-ink-3")}>{children}</span>
    </span>
  );
}

export const linkCls = "inline-flex w-fit items-center gap-1 text-xs text-hl-2 underline decoration-hl underline-offset-[3px]";
export const quietBtn = "w-fit text-xs text-ink-3 underline underline-offset-[3px] hover:text-ink";

export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative block h-5 w-9 shrink-0 rounded-full transition-colors duration-(--dur-short) disabled:cursor-not-allowed disabled:opacity-40", checked ? "bg-hl" : "bg-paper-3 shadow-groove")}>
      <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-cotton shadow-stock transition-transform duration-(--dur-short) ease-(--ease-out)", checked && "translate-x-4")} />
    </button>
  );
}

/** A picked / unpicked tile (role, mascot, drawing, preset mix): the border and wash say which. */
export const picked = (on: boolean) => cn("transition-[background-color,border-color] duration-(--dur-micro)", on ? "border-hl bg-hl-wash" : "border-rule hover:border-rule-2 hover:bg-paper-2");

/** An error-code map of keys, translated for `errorText`. */
export const tMap = (t: (k: Key) => string, m: Record<string, Key>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, t(v)]));

/** Server-side privacy switches (backend/telegram_dashboard/privacy.py, data/config.json). */
type Privacy = { redact: boolean; notify_preview: boolean };
export function usePrivacy() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["privacy"], queryFn: ({ signal }) => api<Privacy>("/privacy", { signal }), retry: false });
  const m = useMutation({
    mutationFn: (v: Privacy) => api<Privacy>("/privacy", { method: "PUT", json: v }),
    onSuccess: (v) => qc.setQueryData(["privacy"], v),
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không lưu được, thử lại")) }),
  });
  const p = (m.isPending && m.variables) || q.data;
  return { p, set: (patch: Partial<Privacy>) => p && m.mutate({ ...p, ...patch }), busy: m.isPending };
}

/** After the server was asked to restart (update, data move): reload the page once the new one answers.
 *  False after a minute without it. */
export async function waitRestart() {
  await new Promise((ok) => setTimeout(ok, 2000));
  for (let i = 0; i < 60; i++) {
    if (await fetch("/health", { cache: "no-store" }).then((x) => x.ok, () => false)) { location.reload(); return true; }
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  return false;
}
