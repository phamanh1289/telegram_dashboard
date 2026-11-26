"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Info } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { Fold } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { Pill } from "@/shared/components/ui/segmented";
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
 *  `advanced`: rarely changed; folded to its title until opened (animated both ways), so the everyday settings come first;
 *  `badge` shows beside the title while folded (e.g. how many rules it holds). `title` (the key) is
 *  also the search's scroll anchor (`data-card`), the same in both languages. `fill`: the card takes its parent's height
 *  and its one child the rest below the title (that child decides what scrolls). */
export function Card({ title, info, action, advanced, badge, fill, children }: { title: Key; info?: Key; action?: React.ReactNode; advanced?: boolean; badge?: React.ReactNode; fill?: boolean; children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(!advanced);
  const body = <div className={cn("grid divide-y divide-rule px-4 pb-4 sm:px-5", fill && "min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)]")}>{children}</div>;
  return (
    <section aria-label={t(title)} data-card={title} className={cn("grid scroll-mt-24 rounded-[var(--radius-card)] border border-rule bg-cotton shadow-stock outline-offset-2 data-flash:outline-2 data-flash:outline-hl", fill && "h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)]")}>
      {/* A folding card's whole header toggles it (the mouse's bigger target); the button inside stays the keyboard's and
          screen reader's control, and clicks on the header's other buttons (the bulb, an action) keep their own job. */}
      <header onClick={advanced ? (e) => { if (!(e.target as Element).closest("button, a, input")) setOpen(!open); } : undefined}
        className={cn("group/head flex min-h-11 items-center gap-1.5 px-4 py-3 sm:px-5", advanced && "cursor-pointer select-none")}>
        {advanced ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-sm text-sm font-bold text-ink">
            {/* the chevron lights up anywhere over the header, saying the whole row folds */}
            <ChevronDown className={cn("size-4 text-ink-3 transition-[rotate,color] duration-(--dur-short) ease-(--ease-out) group-hover/head:text-ink", !open && "-rotate-90")} aria-hidden />
            <h3>{t(title)}</h3>
            <span className="rounded-full bg-paper-2 px-1.5 text-2xs font-medium text-ink-3">{t("Nâng cao")}</span>
            {!open && badge}
          </button>
        ) : <h3 className="text-sm font-bold text-ink">{t(title)}</h3>}
        {info && <InfoHint title={t(title)} text={t(info)} />}
        {action && open && <span className="ml-auto flex items-center gap-2">{action}</span>}
      </header>
      {advanced ? <Fold open={open}>{body}</Fold> : body}
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

/** The height that takes `ref` to the bottom of the window less the page's bottom padding, so the page itself does not
 *  scroll; `min` at least (a short window scrolls the page rather than squeeze the form). null below the page's `md`
 *  layout (the menu on top, chips wrapping): the form keeps its natural height there and the page scrolls. */
export function useFillHeight(ref: React.RefObject<HTMLElement | null>, min: number) {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wide = matchMedia("(min-width: 48rem)");
    const fit = () => {
      if (!wide.matches) return setH(null);
      const pad = parseFloat(getComputedStyle(el.closest("main")?.parentElement ?? el).paddingBottom) || 0;
      setH(Math.max(min, Math.floor(innerHeight - (el.getBoundingClientRect().top + scrollY) - pad)));
    };
    fit();
    // The window, and anything above that settles late (fonts, the header's wrap): `fit` never moves our own top, so
    // the observer settles after one pass.
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    addEventListener("resize", fit);
    wide.addEventListener("change", fit);
    return () => { ro.disconnect(); removeEventListener("resize", fit); wide.removeEventListener("change", fit); };
  }, [ref, min]);
  return h;
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

/** A picked / unpicked tile (role, mascot, drawing, preset mix). The picked tile's border and wash are a `PickPill`
 *  that slides between tiles like `Segmented`; the tile's own border hides under it. */
export const picked = (on: boolean) => cn("relative isolate transition-[background-color,border-color] duration-(--dur-micro)", on ? "border-transparent" : "border-rule hover:border-rule-2 hover:bg-paper-2");

/** The picked tile's sliding highlight: `id` per group, `className` the tile's radius. Behind the content (`-z-10` in the tile's `isolate`). */
export const PickPill = ({ id, on, className }: { id: string; on: boolean; className: string }) =>
  on ? <Pill id={id} className={cn("-inset-px -z-10 border border-hl bg-hl-wash", className)} /> : null;

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
