"use client";

import { BookOpen, ChevronDown, MousePointerClick, Search, Send, Settings, Sparkles } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AiResultCard, AiThinking, AiWriting, UserBubble } from "@/components/ai/chat";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { GuideBulb, Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { apiStream, errorText } from "@/lib/api";
import { fold } from "@/lib/inbox";
import GUIDE from "@/lib/guide.json";
import { cn } from "@/lib/utils";
import { GuideTour, readTour, saveTour, type TourState } from "./guide-tour";
import { YtLogo } from "@/components/yt-logo";

// In-app user guide: every feature of the Telegram / YouTrack tabs (lib/guide.json), one search box,
// "Hỏi AI" over the same catalog, and a live walk-through of a feature's steps on the page (guide-tour).

type Tab = "telegram" | "youtrack" | "settings";
export type Module = "telegram" | "youtrack" | "settings";
/** A step: text with UI labels in quotes; `at` names the control the live guide lights (a label, or `css:<selector>`; several: first found). */
export type Step = string | { t: string; at?: string | string[] };
export type Feature = { id: string; tab: Tab; area: string; title: string; what: string; how: Step[]; keys?: string };
export const stepText = (s: Step) => (typeof s === "string" ? s : s.t);
const ALL = GUIDE as Feature[];
const BY_ID = new Map(ALL.map((f) => [f.id, f]));
const TAB: Record<Tab, { label: string; Icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  telegram: { label: "Telegram", Icon: Send, tone: "bg-info-wash text-info" },
  youtrack: { label: "YouTrack", Icon: YtLogo, tone: "bg-hl-wash text-hl-2" },
  settings: { label: "Cài đặt", Icon: Settings, tone: "bg-paper-3 text-ink-2" },
};


/** A step with its quoted UI labels drawn as little keys. */
export function StepText({ text }: { text: string }) {
  return text.split(/["“]([^"”]{1,60})["”]/).map((p, i) => i % 2
    ? <span key={i} className={cn("mx-0.5 rounded-[5px] border border-rule-2 bg-paper-2 px-1.5 py-px text-[0.92em] font-medium text-ink", p.length < 25 && "whitespace-nowrap")}>{p}</span>
    : p);
}

const INDEX = ALL.map((f) => ({ f, title: fold(f.title), keys: fold(`${f.keys ?? ""} ${f.area}`), body: fold(`${f.what} ${f.how.map(stepText).join(" ")}`) }));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Features ranked by query words (matched at word starts): a title hit counts most, then keywords/area, then description and steps; `here` (the open tab) breaks ties. */
function search(q: string, tab: Tab | "all", here: string) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const pool = INDEX.filter((x) => tab === "all" || x.f.tab === tab);
  if (!words.length) return pool.map((x) => x.f);
  // ponytail: regex scoring over ~150 items; a real index only if the catalog grows a lot
  const res = words.map((w) => new RegExp(`(^|[^a-z0-9])${esc(w)}`));
  const phrase = new RegExp(`(^|[^a-z0-9])${esc(words.join(" "))}`);
  const scored = pool.map((x) => {
    let score = 0, hit = 0;
    for (const r of res) {
      const s = (r.test(x.title) ? 5 : 0) + (r.test(x.keys) ? 3 : 0) + (r.test(x.body) ? 1 : 0);
      if (s) hit++;
      score += s;
    }
    if (words.length > 1) score += (phrase.test(x.title) ? 15 : 0) + (phrase.test(x.keys) ? 8 : 0) + (phrase.test(x.body) ? 4 : 0);
    return { f: x.f, score: score + (hit === words.length ? 20 : 0) + (x.f.tab === here ? 2 : 0), hit };
  });
  return scored.filter((s) => s.hit).sort((a, b) => b.score - a.score).map((s) => s.f);
}

/** The catalog as compact text for the AI. */
const GUIDE_TEXT = ALL.map((f) => `[${f.id}] ${TAB[f.tab].label} › ${f.area} › ${f.title}: ${f.what} Cách dùng: ${f.how.map((h, i) => `${i + 1}) ${stepText(h)}`).join(" ")}`).join("\n");
const AI_ERR = { ai_provider_error: "AI không chạy được.", ai_failed: "AI không chạy được.", validation: "Câu hỏi quá dài." };

export function GuideButton({ module }: { module: Module }) {
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState<TourState | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "F1") { e.preventDefault(); setOpen(true); } };
    document.addEventListener("keydown", k);
    // a walk-through going on (it moved here through a link): carry on once the page has rendered
    const saved = readTour();
    const t = saved && BY_ID.has(saved.id) ? setTimeout(() => setTour(saved), 300) : undefined;
    return () => { document.removeEventListener("keydown", k); clearTimeout(t); };
  }, []);
  function start(f: Feature) {
    setOpen(false);
    const s = { id: f.id, from: module, i: 0 };
    saveTour(s);
    setTimeout(() => setTour(s), 200); // after the dialog's exit
  }
  return (
    <>
      <Hint side="bottom" title="Hướng dẫn" text="Tìm cách dùng mọi tính năng Telegram / YouTrack, hỏi AI, hoặc để app chỉ trực tiếp trên màn hình (F1).">
        <Button size="icon-sm" variant="ghost" aria-label="Hướng dẫn sử dụng" onClick={() => setOpen(true)}><GuideBulb className="size-5" /></Button>
      </Hint>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(88dvh,50rem)] flex-col gap-3 sm:max-w-2xl">
          {open && <Guide module={module} onTour={start} />}
        </DialogContent>
      </Dialog>
      {tour && <GuideTour key={tour.id} f={BY_ID.get(tour.id)!} from={tour.from} start={tour.i} onEnd={() => setTour(null)} />}
    </>
  );
}

type Ai = { q: string; text: string; busy: boolean; error?: string };

function Guide({ module, onTour }: { module: Module; onTour: (f: Feature) => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [ai, setAi] = useState<Ai | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const dq = useDeferredValue(q);
  const hits = useMemo(() => search(dq, tab, module), [dq, tab, module]);

  async function ask() {
    const question = q.trim();
    if (!question) return;
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setAi({ q: question, text: "", busy: true });
    try {
      const r = await apiStream<{ text: string }>("/ai/guide", { question, guide: GUIDE_TEXT }, ctl.signal,
        (text) => setAi({ q: question, text, busy: true }));
      setAi({ q: question, text: r.text, busy: false });
    } catch (e) {
      if (!ctl.signal.aborted) setAi({ q: question, text: "", busy: false, error: errorText(e, AI_ERR, "AI không trả lời được.") });
    }
  }

  return (
    <>
      <DialogTitle className="flex items-center gap-2"><GuideBulb className="size-5" />Hướng dẫn sử dụng</DialogTitle>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm tính năng"
            placeholder="Tìm tính năng hoặc hỏi: làm sao tóm tắt nhóm?"
            className="h-9 w-full rounded-md border border-rule-2 bg-cotton pr-3 pl-8 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3" />
        </div>
        <Hint side="bottom" title="Hỏi AI" text="AI đọc toàn bộ hướng dẫn và trả lời câu hỏi của bạn (Enter).">
          <Button type="submit" disabled={!q.trim() || ai?.busy}><Sparkles />Hỏi AI</Button>
        </Hint>
      </form>
      <Segmented id="guide-tab" label="Khu vực" value={tab} onChange={setTab} className="self-start"
        items={[{ value: "all", label: "Tất cả" }, { value: "telegram", label: "Telegram" }, { value: "youtrack", label: "YouTrack" }, { value: "settings", label: "Cài đặt" }]} />
      <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5 pb-1">
        {ai && <AiAnswer ai={ai} onClose={() => { abort.current?.abort(); setAi(null); }} onOpen={(id) => { setTab("all"); setQ(""); setOpen(id); }} onTour={onTour} />}
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <BookOpen className="size-3.5 text-ink-3" aria-hidden />{dq.trim() ? "Tính năng phù hợp" : "Mọi tính năng"} <span className="font-mono font-normal text-ink-3 tabular-nums">{hits.length}</span><span className="h-px flex-1 bg-rule" />
        </h3>
        {hits.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">Không tìm thấy tính năng khớp. Bấm <b>Hỏi AI</b> để hỏi bằng câu tự nhiên.</p>
        ) : (
          <ul className="grid gap-2">
            {hits.map((f) => <Item key={f.id} f={f} on={open === f.id} toggle={() => setOpen(open === f.id ? null : f.id)} onTour={onTour} />)}
          </ul>
        )}
      </div>
    </>
  );
}

/** The AI's answer, in the shared AI chat look (components/ai/chat); features it names become buttons under it. */
function AiAnswer({ ai, onClose, onOpen, onTour }: { ai: Ai; onClose: () => void; onOpen: (id: string) => void; onTour: (f: Feature) => void }) {
  const refs = [...new Set([...ai.text.matchAll(/\[([a-z0-9-]+)\]/g)].map((m) => m[1]))].flatMap((id) => BY_ID.get(id) ?? []);
  const text = ai.text.replace(/\s*\[([a-z0-9-]+)\]/g, (m, id) => (BY_ID.has(id) ? "" : m));
  return (
    <section aria-label="Trợ lý AI" aria-live="polite" className="mb-4 grid grid-cols-[minmax(0,1fr)] gap-3">
      <header className="flex items-center gap-1.5 text-xs font-semibold text-hl-2">
        <Sparkles className="size-3.5" aria-hidden />Trợ lý AI
        <button type="button" onClick={onClose} className="ml-auto font-medium text-ink-3 hover:text-ink">{ai.busy ? "Dừng" : "Đóng"}</button>
      </header>
      <UserBubble>{ai.q}</UserBubble>
      {ai.error ? <AiResultCard error>{ai.error}</AiResultCard>
        : ai.busy ? (text ? <><Markdown text={text} className="px-0.5 text-ink" /><AiWriting /></> : <AiThinking label="Đang đọc hướng dẫn" />)
        : <AiResultCard><Markdown text={text} /></AiResultCard>}
      {!ai.busy && refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
          {refs.map((f) => (
            <span key={f.id} className="flex items-center overflow-hidden rounded-full border border-rule-2 bg-cotton text-xs">
              <button type="button" onClick={() => onOpen(f.id)} className="px-2.5 py-1 font-medium hover:bg-paper-2">{f.title}</button>
              <Hint side="bottom" title="Chỉ cho tôi" text="Mở đúng trang và làm sáng từng nút cần bấm.">
                <button type="button" aria-label={`Chỉ cho tôi: ${f.title}`} onClick={() => onTour(f)} className="border-l border-rule-2 px-2 py-1 text-hl-2 hover:bg-hl-wash"><MousePointerClick className="size-3.5" /></button>
              </Hint>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Item({ f, on, toggle, onTour }: { f: Feature; on: boolean; toggle: () => void; onTour: (f: Feature) => void }) {
  const t = TAB[f.tab];
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (on) setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 220); }, [on]);
  return (
    <li ref={ref} className={cn("rounded-lg border bg-cotton transition-[border-color,box-shadow] duration-(--dur-short)", on ? "border-hl/40 shadow-pop" : "border-rule hover:border-rule-2")}>
      <button type="button" aria-expanded={on} onClick={toggle} className="flex w-full items-start gap-3 p-3 text-left">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", t.tone)}><t.Icon className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">{f.title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">{t.label} › {f.area}</span>
          <span className={cn("mt-1.5 block text-sm leading-relaxed text-ink-2", !on && "line-clamp-2")}>{f.what}</span>
        </span>
        <ChevronDown className={cn("mt-1.5 size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-short)", on && "rotate-180")} aria-hidden />
      </button>
      <div inert={!on} className={cn("grid transition-[grid-template-rows,opacity] duration-(--dur-short) ease-(--ease-out)", on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="min-h-0 overflow-hidden">
          <div className="mr-3 mb-3 ml-14 border-t border-rule pt-3">
            <ol className="grid gap-2.5">
              {f.how.map((h, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-hl-wash font-mono text-[11px] font-semibold text-hl-2">{i + 1}</span>
                  <span><StepText text={stepText(h)} /></span>
                </li>
              ))}
            </ol>
            <Button size="sm" className="mt-3" onClick={() => onTour(f)}><MousePointerClick />Chỉ cho tôi trên màn hình</Button>
          </div>
        </div>
      </div>
    </li>
  );
}
