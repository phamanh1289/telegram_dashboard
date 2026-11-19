"use client";

import { RotateCw, Search, TriangleAlert, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Toaster, TopBar } from "@/app/_components/shell";
import { Button } from "@/shared/components/ui/button";
import { NoPick } from "@/shared/components/ui/empty";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { type DocFilter, docErrors, docSourcesQuery, syncErrorText, useDocSync } from "@/features/docs/lib/docs";
import { AiAsk } from "@/features/youtrack/components/bits";
import { TicketSheetHost } from "@/features/telegram/components/message/rich-text";
import { DocAsk } from "./ask";
import { Results } from "./results";
import { Reader } from "./reader";
import { GrowButton } from "./grow-button";
import { Sources } from "./sources";

// Tài liệu (/docs/): the source tabs on top, then the search box (narrow until used), Cập nhật and Thêm (the sources); results left, the open document
// right (one column in a narrow box), the AI popup over the reader's top right. Esc closes the popup, then the document. The state lives in the URL (?q=&source=&ticket=&doc=&part=), so a link reopens it.

type View = { q: string; f: DocFilter; part: number | null };
const SOURCES = ["youtrack", "telegram", "file", "kb_cache"] as const;

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
  const [ai, setAi] = useState(false);
  const [adding, setAdding] = useState(false); // the sources dialog (Thêm), also opened from the empty list
  const [wide, setWide] = useState(false); // the search box: narrow until focused or filled
  const filter = (x: Partial<DocFilter>) => setView((v) => ({ ...v, f: { ...v.f, ...x } }));
  const open = (doc: number | null, p: number | null = null) => setView((v) => ({ ...v, f: { ...v.f, doc }, part: p }));
  // stable: the reader's article links are drawn with it, and a new one would redraw every rendered part
  const openDoc = useCallback((doc: number) => setView((v) => ({ ...v, f: { ...v.f, doc }, part: null })), []);
  // Esc: closes the AI popup, else the open document (not while typing, or while a dialog / menu has it)
  const reading = f.doc != null;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      if (el.closest?.("input, textarea, select, [contenteditable], [data-doc-ask]")) return;
      if (document.querySelector("[role=dialog], [role=menu], [role=listbox]")) return;
      if (ai) setAi(false);
      else if (reading) setView((v) => ({ ...v, f: { ...v.f, doc: null }, part: null }));
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [ai, reading]);

  return (
    <div className="grid h-dvh grid-rows-[2.75rem_minmax(0,1fr)]">
      <TopBar module="docs" />
      <main className="@container/docs flex min-h-0 flex-col">
        {/* one row: the source tabs and filter chips, then the search box, Cập nhật and Thêm on the right; wraps when narrow */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-paper-2 px-4 py-2">
            <Segmented id="docs-source" label={t("Lọc theo nguồn")} value={f.source} onChange={(source) => filter({ source })}
              items={[{ value: "all", label: t("Tất cả") }, { value: "youtrack", label: "YouTrack" }, { value: "telegram", label: "Telegram" }, { value: "file", label: t("Khác") }]} />
            {f.source === "kb_cache" && (
              <Chip clear={t("Bỏ lọc bài KB ngoài nguồn")} onClear={() => filter({ source: "all" })}>{t("bài KB ngoài nguồn (AI Agent đã mở)")}</Chip>
            )}
            {f.ticket && (
              <Chip clear={t("Bỏ lọc ticket")} onClear={() => filter({ ticket: null })}>
                {t("lọc ticket:")} <span className="font-mono font-medium">{f.ticket}</span>
              </Chip>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              <label className={cn("relative min-w-0 transition-[width] duration-(--dur-short) ease-(--ease-out)", wide || text ? "w-[min(28rem,60cqw)]" : "w-56")}>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
                <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Tìm trong mọi tài liệu…")} aria-label={t("Tìm trong tài liệu")}
                  onFocus={() => setWide(true)} onBlur={() => setWide(false)} className="pl-8" />
              </label>
              <Hint side="bottom" text={t("Đồng bộ lại mọi nguồn ngay (bỏ qua lần đồng bộ gần đây).")}>
                <GrowButton aria-label={t("Cập nhật")} aria-busy={sync.isPending} disabled={sync.isPending} onClick={() => sync.mutate(true)}
                  icon={<RotateCw className={cn(sync.isPending && "animate-spin")} />} label={t("Cập nhật")} />
              </Hint>
              <Sources open={adding} onOpenChange={setAdding} onSaved={() => sync.mutate(true)} onView={() => filter({ source: "kb_cache" })} />
            </div>
        </div>
        <SyncBanner error={sync.error} retrying={sync.isPending} onRetry={() => sync.mutate(true)} />
        {/* list | reader, the AI popup over the reader (opened from the reader's AI chip, or the empty reader's "Hỏi AI") */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] @max-3xl/docs:grid-cols-1">
          <div className={cn("flex min-h-0 flex-col border-r @max-3xl/docs:border-r-0", (f.doc != null || ai) && "@max-3xl/docs:hidden")}>
            <Results q={q} f={f} part={part} syncing={sync.isPending} onOpen={open} onAdd={() => setAdding(true)} />
          </div>
          <div className={cn("relative flex min-h-0 bg-cotton", f.doc == null && !ai && "@max-3xl/docs:hidden")}>
            <div className="flex min-w-0 flex-1 flex-col">
              {f.doc != null
                ? <Reader key={f.doc} id={f.doc} part={part} q={q} onPart={(p) => open(f.doc, p)} onTicket={(ticket) => filter({ ticket })}
                    onBack={() => open(null)} onAi={() => setAi((x) => !x)} onDoc={openDoc} />
                : (
                  <NoPick title={t("Chọn một tài liệu")}>
                    {t("Bấm một tài liệu hoặc một đoạn khớp bên trái để đọc ở đây.")}
                    {!ai && (
                      <span className="mt-4 flex justify-center">
                        <AiAsk big text={q ? t("Hỏi AI trên kết quả tìm") : t("Hỏi AI trên tài liệu")} label={t("Mở panel hỏi AI")}
                          hint={t("Hỏi mình, mình tìm trong tài liệu rồi trả lời kèm nguồn!")} onClick={() => setAi(true)} />
                      </span>
                    )}
                  </NoPick>
                )}
            </div>
            <DocAsk q={q} f={f} onOpen={open} open={ai} onClose={() => setAi(false)} />
          </div>
        </div>
      </main>
      {/* a ticket chip in a document or the header opens the YouTrack tab's ticket sheet here (ticketClick) */}
      <TicketSheetHost />
      <Toaster />
    </div>
  );
}

/** A filter that is not a tab of "Lọc theo nguồn", with its × to drop it. */
function Chip({ clear, onClear, children }: { clear: string; onClear: () => void; children: ReactNode }) {
  return (
    <span className="flex h-7 items-center gap-1 rounded-full bg-hl-wash pr-1 pl-2.5 text-xs text-hl-2">
      {children}
      <Button size="icon-xs" variant="ghost" className="size-5" aria-label={clear} onClick={onClear}><X /></Button>
    </span>
  );
}

/** Opening the screen syncs once (the server skips it while fresh). Nothing is chosen for a first use: the user adds the
 *  Knowledge Base branches / folders to read (Thêm). */
function useFirstSync() {
  const sync = useDocSync();
  const ran = useRef(false);
  const { mutate } = sync;
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    mutate(false);
  }, [mutate]);
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
