"use client";

import { RotateCw, Search, TriangleAlert, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Toaster, TopBar } from "@/app/_components/shell";
import { Button } from "@/shared/components/ui/button";
import { NoPick } from "@/shared/components/ui/empty";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { getPref, setPref } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { ytProjectsQuery } from "@/features/youtrack/lib/yt";
import { useYtProject } from "@/features/youtrack/components/ticket-form";
import { type DocFilter, docErrors, docs, docSourcesQuery, syncErrorText, useDocSync } from "@/features/docs/lib/docs";
import { DocAsk } from "./ask";
import { Results } from "./results";
import { Reader } from "./reader";
import { Sources, SOURCES_SET } from "./sources";

// Tài liệu (/docs/): search box, ⟳ and "Nguồn ▾" on top, the source filter under it; results left, the open document
// right (one column in a narrow box), the AI box pinned under them. The state lives in the URL (?q=&source=&ticket=&doc=&part=), so a link reopens it.

type View = { q: string; f: DocFilter; part: number | null };
const SOURCES = ["youtrack", "telegram", "file"] as const;

function readUrl(search = location.search): View {
  const p = new URLSearchParams(search);
  const int = (k: string) => (/^\d+$/.test(p.get(k) ?? "") ? Number(p.get(k)) : null);
  const s = p.get("source");
  return {
    q: p.get("q") ?? "",
    f: { source: SOURCES.find((x) => x === s) ?? "all", ticket: p.get("ticket") || null, doc: int("doc") },
    part: int("part"),
  };
}
function writeUrl({ q, f, part }: View) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (f.source !== "all") p.set("source", f.source);
  if (f.ticket) p.set("ticket", f.ticket);
  if (f.doc != null) p.set("doc", String(f.doc));
  if (f.doc != null && part != null) p.set("part", String(part));
  try { history.replaceState(null, "", p.size ? `?${p}` : location.pathname); } catch {}
}

const noop = () => () => {};
export function DocsApp() {
  // the state starts from the URL: render in the browser only (the static export prerenders an empty shell)
  const client = useSyncExternalStore(noop, () => true, () => false);
  return client ? <Docs /> : null;
}

function Docs() {
  const t = useT();
  const [view, setView] = useState(readUrl);
  const [text, setText] = useState(view.q);
  const { q, f, part } = view;
  useEffect(() => writeUrl(view), [view]);
  // the box feeds the search 200ms after the last key
  useEffect(() => {
    const id = setTimeout(() => setView((v) => (v.q === text.trim() ? v : { ...v, q: text.trim() })), 200);
    return () => clearTimeout(id);
  }, [text]);
  // the guide's links to this page while on it (guide.tsx `go`)
  useEffect(() => {
    const on = (e: Event) => { const v = readUrl(`?${(e as CustomEvent<URLSearchParams>).detail}`); setView(v); setText(v.q); };
    addEventListener("guide-go", on);
    return () => removeEventListener("guide-go", on);
  }, []);

  const sync = useFirstSync();
  const filter = (x: Partial<DocFilter>) => setView((v) => ({ ...v, f: { ...v.f, ...x } }));
  const open = (doc: number | null, p: number | null = null) => setView((v) => ({ ...v, f: { ...v.f, doc }, part: p }));

  return (
    <div className="grid h-dvh grid-rows-[2.75rem_minmax(0,1fr)]">
      <TopBar module="docs" />
      <main className="@container/docs flex min-h-0 flex-col">
        <div className="grid gap-2 border-b bg-paper-2 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <label className="relative max-w-2xl min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
              <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Tìm trong tài liệu…")} aria-label={t("Tìm trong tài liệu")} className="pl-8" />
            </label>
            <Hint side="bottom" text={t("Đồng bộ lại mọi nguồn ngay (bỏ qua lần đồng bộ gần đây).")}>
              <Button size="icon-sm" variant="ghost" aria-label={t("Đồng bộ lại")} aria-busy={sync.isPending} disabled={sync.isPending} onClick={() => sync.mutate(true)}>
                <RotateCw className={cn(sync.isPending && "animate-spin")} />
              </Button>
            </Hint>
            <Sources onSaved={() => sync.mutate(true)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented id="docs-source" label={t("Lọc theo nguồn")} value={f.source} onChange={(source) => filter({ source })}
              items={[{ value: "all", label: t("Tất cả") }, { value: "youtrack", label: "YouTrack" }, { value: "telegram", label: "Telegram" }, { value: "file", label: "File" }]} />
            {f.ticket && (
              <span className="flex h-7 items-center gap-1 rounded-full bg-hl-wash pr-1 pl-2.5 text-xs text-hl-2">
                {t("lọc ticket:")} <span className="font-mono font-medium">{f.ticket}</span>
                <Button size="icon-xs" variant="ghost" className="size-5" aria-label={t("Bỏ lọc ticket")} onClick={() => filter({ ticket: null })}><X /></Button>
              </span>
            )}
          </div>
        </div>
        <SyncBanner error={sync.error} retrying={sync.isPending} onRetry={() => sync.mutate(true)} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] @max-3xl/docs:grid-cols-1">
          <div className={cn("flex min-h-0 flex-col border-r @max-3xl/docs:border-r-0", f.doc != null && "@max-3xl/docs:hidden")}>
            <Results q={q} f={f} part={part} syncing={sync.isPending} onOpen={open} />
          </div>
          <div className={cn("flex min-h-0 flex-col bg-cotton", f.doc == null && "@max-3xl/docs:hidden")}>
            {f.doc != null
              ? <Reader key={f.doc} id={f.doc} part={part} q={q} onPart={(p) => open(f.doc, p)} onTicket={(ticket) => filter({ ticket })} onBack={() => open(null)} />
              : <NoPick title={t("Chọn một tài liệu")}>{t("Bấm một tài liệu hoặc một đoạn khớp bên trái để đọc ở đây.")}</NoPick>}
          </div>
        </div>
        <DocAsk q={q} f={f} onOpen={open} />
      </main>
      <Toaster />
    </div>
  );
}

/** Opening the screen syncs once (the server skips it while fresh). First use, with no source chosen yet: the YouTrack
 *  tab's project, then a full sync. */
function useFirstSync() {
  const sync = useDocSync();
  const src = useQuery(docSourcesQuery);
  const projects = useQuery(ytProjectsQuery);
  const project = useYtProject();
  const ran = useRef(false);
  const ready = !!src.data && !projects.isPending;
  const { mutate } = sync;
  useEffect(() => {
    if (!ready || ran.current || !src.data) return;
    ran.current = true;
    const first = !src.data.projects.length && !src.data.folders.length && !getPref(SOURCES_SET) && projects.isSuccess;
    if (!first) { mutate(false); return; }
    docs.setSources({ projects: [project], folders: [] }).then(() => { setPref(SOURCES_SET, "1"); mutate(true); },
      (e) => { toast({ text: errorText(e, docErrors()) }); mutate(false); });
  }, [ready, src.data, projects.isSuccess, project, mutate]);
  return sync;
}

/** What failed: the sync call itself, the sources read, or single sources (each keeps its old docs, so the list stays). */
function SyncBanner({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  const t = useT();
  const src = useQuery(docSourcesQuery);
  const lines = [
    ...(error ? [errorText(error, docErrors())] : []),
    ...(src.isError ? [errorText(src.error, docErrors())] : []),
    ...(src.data?.errors ?? []).map(syncErrorText),
  ];
  if (!lines.length) return null;
  return (
    <div role="alert" className="flex items-start gap-2 border-b bg-error-wash px-4 py-2 text-xs text-error">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium">{t("Đồng bộ chưa trọn: tài liệu cũ vẫn giữ, có thể đã cũ.")}</span>
        {lines.slice(0, 3).map((l, i) => <span key={i} className="truncate text-ink-2">{l}</span>)}
        {lines.length > 3 && <span className="text-ink-3">{t("và {n} lỗi khác (xem ở \"Nguồn\")", { n: lines.length - 3 })}</span>}
      </div>
      <Button size="xs" variant="outline" aria-busy={retrying} disabled={retrying} onClick={onRetry}><RotateCw />{t("Thử lại")}</Button>
    </div>
  );
}
