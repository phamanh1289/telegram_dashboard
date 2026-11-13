"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, MousePointerClick, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AiBot, AiPromptBox, AiResultCard, AiSend, AiThinking, UserBubble, useFollow } from "@/components/ai/chat";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { apiStream, errorText, statusQuery } from "@/lib/api";
import { type Key, type Lang, type T, tr, useLang, useT } from "@/lib/i18n";
import { BOT_SIZES, type BotCorner, type BotMode, setPref, useBotCode, useBotDock, useBotMode, useBotShow, useBotSize } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { shortName, ytMeQuery } from "@/lib/yt";
import { GuideTour, readTour, saveTour, type TourState } from "./guide-tour";

// In-app user guide as a floating "know-it-all" bot: a chat with the AI over every feature of the Telegram / YouTrack tabs
// (lib/guide.json, English: lib/guide.en.json) and, when allowed, the app's own code; each answer ends in buttons that take
// you there: open the page, or a live walk-through of the feature's steps on the page (guide-tour).

type Tab = "telegram" | "youtrack" | "settings";
export type Module = "telegram" | "youtrack" | "settings";
/** A step: text with UI labels in quotes; `at` names the control the live guide lights (a label, or `css:<selector>`; several: first found). */
export type Step = string | { t: string; at?: string | string[] };
export type Feature = { id: string; tab: Tab; area: string; title: string; what: string; how: Step[]; keys?: string };
export const stepText = (s: Step) => (typeof s === "string" ? s : s.t);
const TAB: Record<Tab, Key> = { telegram: "Telegram", youtrack: "YouTrack", settings: "Cài đặt" };


/** A step with its quoted UI labels drawn as little keys. */
export function StepText({ text }: { text: string }) {
  return text.split(/["“]([^"”]{1,60})["”]/).map((p, i) => i % 2
    ? <span key={i} className={cn("mx-0.5 rounded-[5px] border border-rule-2 bg-paper-2 px-1.5 py-px text-[0.92em] font-medium text-ink", p.length < 25 && "whitespace-nowrap")}>{p}</span>
    : p);
}

/** One language's guide: the features, by id, and the whole catalog as compact text for the AI. */
type Catalog = { byId: Map<string, Feature>; text: string };
function build(all: Feature[], lang: Lang): Catalog {
  return {
    byId: new Map(all.map((f) => [f.id, f])),
    text: all.map((f) => `[${f.id}] ${tr(lang, TAB[f.tab])} › ${f.area} › ${f.title}: ${f.what} ${tr(lang, "Cách dùng:")} ${f.how.map((h, i) => `${i + 1}) ${stepText(h)}`).join(" ")}`).join("\n"),
  };
}
// the guide is big: each language loads on first use, not with the app shell
const LOAD: Record<Lang, () => Promise<{ default: unknown }>> = { vi: () => import("@/lib/guide.json"), en: () => import("@/lib/guide.en.json") };
const CATALOG: Partial<Record<Lang, Catalog>> = {};
/** The guide in the live language once `need` (null while it loads); `failed` when it could not load. */
function useCatalog(need: boolean) {
  const lang = useLang();
  const [failed, setFailed] = useState<Lang | null>(null);
  const [, loaded] = useState(0);
  useEffect(() => {
    if (!need || CATALOG[lang]) return;
    let live = true;
    LOAD[lang]().then(
      (m) => { CATALOG[lang] = build(m.default as Feature[], lang); if (live) loaded((n) => n + 1); },
      () => { if (live) setFailed(lang); },
    );
    return () => { live = false; };
  }, [need, lang]);
  return { cat: CATALOG[lang] ?? null, failed: failed === lang };
}
const AI_ERR: Record<string, Key> = { ai_provider_error: "AI không chạy được.", ai_failed: "AI không chạy được.", validation: "Câu hỏi quá dài." };

/** One question to the bot and its answer (`error` instead when it failed). */
type Turn = { q: string; a: string; error?: string };
const BOT_KEY = "guide-bot"; // open + conversation (sessionStorage): survives a reload; the module keeps it across pages
const GAP = 16, TOP = 56; // GAP: the floating bot's margin on every edge; TOP: the chat panel's, under the top bar
// bot and chat: z-[55], over the side panel and dialogs (z-50), under the toast (z-[60]) and the walk-through (z-[70])
type Pt = { x: number; y: number };
/** `from`: the centre of the bot the chat opened from (it grows out of it, and shrinks back into it). */
type BotState = { open: boolean; turns: Turn[]; from?: Pt | null };
const SERVER: BotState = { open: false, turns: [] };
function loadBot(): BotState {
  try { return { ...SERVER, ...JSON.parse(sessionStorage.getItem(BOT_KEY) ?? "null") }; } catch { return SERVER; }
}
let BOT_STATE: BotState = typeof window === "undefined" ? SERVER : loadBot();
const botSubs = new Set<() => void>();
function setBot(p: Partial<BotState>) {
  BOT_STATE = { ...BOT_STATE, ...p };
  try { sessionStorage.setItem(BOT_KEY, JSON.stringify(BOT_STATE)); } catch {}
  botSubs.forEach((f) => f());
}
const useBot = () => useSyncExternalStore((f) => (botSubs.add(f), () => botSubs.delete(f)), () => BOT_STATE, () => SERVER);
/** Open the chat from whichever bot is showing (click, F1), or close it. */
function toggleBot() {
  if (BOT_STATE.open) return setBot({ open: false });
  const r = document.querySelector("[data-gb-launcher]")?.getBoundingClientRect();
  setBot({ open: true, from: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null });
}
const onResize = (f: () => void) => (addEventListener("resize", f), () => removeEventListener("resize", f));
/** The viewport as "w h" ("" on the server: the bot is drawn only in the browser). */
const useViewport = () => useSyncExternalStore(onResize, () => `${innerWidth} ${innerHeight}`, () => "");
const fit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const CORNERS: Record<BotCorner, Pt> = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, bl: { x: 0, y: 1 }, br: { x: 1, y: 1 } };
/** The dock pref (a corner, or "x,y") as fractions of the viewport; anything else: bottom right. */
function parseDock(v: string): Pt {
  if (v in CORNERS) return CORNERS[v as BotCorner];
  const [x, y] = v.split(",").map(Number);
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : CORNERS.br; // NaN fails every comparison
}
/** Where a bot of `size` docked at `d` sits in a `w`×`h` viewport (left / top, px): on its edge, never off screen. */
const spot = (d: Pt, size: number, w: number, h: number) =>
  ({ x: fit(d.x * w - size / 2, GAP, w - size - GAP), y: fit(d.y * h - size / 2, GAP, h - size - GAP) });
/** The dock for a bot let go with its centre at (cx, cy): the nearest edge, and where along it. */
function snap(cx: number, cy: number, w: number, h: number) {
  const fx = Math.round((cx / w) * 1000) / 1000, fy = Math.round((cy / h) * 1000) / 1000;
  const edges: [number, string][] = [[cx, `0,${fy}`], [w - cx, `1,${fy}`], [cy, `${fx},0`], [h - cy, `${fx},1`]];
  return edges.reduce((a, b) => (b[0] < a[0] ? b : a))[1];
}
/** The chat panel's box (px): floating, on the bot's side of the screen (left / right, top / bottom half); "side": at the
 *  right, centred under the top bar; "bar": under the top bar, at the right. */
function panelBox(mode: BotMode, bot: Pt | null, w: number, h: number) {
  const width = Math.min(448, w - 32), height = Math.min(704, h - 80);
  const right = w - width - 16;
  if (mode === "side") return { width, height, left: right, top: 44 + Math.max(12, (h - 44 - height) / 2) };
  if (mode === "bar") return { width, height, left: right, top: 52 };
  const c = bot ?? { x: w, y: h };
  return { width, height, left: c.x < w / 2 ? 16 : right, top: c.y < h / 2 ? TOP : h - height - 16 };
}
type Box = ReturnType<typeof panelBox>;
/** The bot landing on its edge once let go: a squash and a wobble (Web Animations, so its CSS bob / pop keep running). */
const LAND: Keyframe[] = [{ scale: "1" }, { scale: "1.14 0.86" }, { scale: "0.94 1.06" }, { scale: "1.03 0.97" }, { scale: "1" }];

/** How the bot calls you (it is "em", you are senior): your YouTrack name, else Telegram's display name; "" = anh/chị. */
function useMyName() {
  const st = useQuery({ ...statusQuery, staleTime: Infinity }).data; // the shell keeps it fresh
  const yt = useQuery({ ...ytMeQuery, enabled: !!st?.youtrack_configured }).data;
  return (yt?.name || st?.telegram_name || "").trim();
}

/** A twinkling four-point star around the bot (`style`: where, size, delay). */
const Spark = ({ className, style }: { className?: string; style?: CSSProperties }) => (
  <svg viewBox="0 0 10 10" aria-hidden className={cn("gb-spark", className)} style={style}>
    <path d="M5 0q.6 3.8 5 5-4.4 1.2-5 5-.6-3.8-5-5 4.4-1.2 5-5z" />
  </svg>
);
/** The glassy orb the bot lives in: orbiting gradient ring, glossy face, sparkles; `ping` adds the calling-out ring. */
function Orb({ px, bot, ping, busy }: { px: number; bot: string; ping?: boolean; busy?: boolean }) {
  const s = Math.max(6, px * 0.2);
  return <>
    {ping && <span aria-hidden className="gb-ping" />}
    <AiBot className={cn("gb-bot relative", bot, busy && "ai-hop")} />
    <Spark className="text-hl" style={{ width: s, height: s, top: -s * 0.2, right: -s * 0.1 }} />
    <Spark className="text-info" style={{ width: s * 0.7, height: s * 0.7, bottom: s * 0.1, left: -s * 0.35, animationDelay: "0.5s" }} />
    <Spark className="text-hl-2" style={{ width: s * 0.55, height: s * 0.55, top: s * 0.3, left: -s * 0.1, animationDelay: "1s" }} />
  </>;
}

/** The know-it-all bot on every page, shown as Cài đặt › Chung › Trợ lý biết tuốt says: floating (drag it anywhere along
 *  an edge of the screen), peeking from the right edge, or a button in the top bar; F1 or a click opens the chat. */
export function GuideBot({ module }: { module: Module }) {
  const t = useT();
  const { open, turns, from } = useBot();
  const show = useBotShow(), mode = useBotMode(), sizeId = useBotSize(), size = BOT_SIZES[sizeId], dock = useBotDock(), code = useBotCode();
  const vp = useViewport();
  const [tour, setTour] = useState<TourState | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null); // left / top while it is dragged
  const grab = useRef<{ dx: number; dy: number; x0: number; y0: number } | null>(null);
  const dragged = useRef(false); // the click that ends a drag does not open the chat
  const name = useMyName();
  const { cat, failed } = useCatalog(open || !!tour);
  const touring = tour && cat?.byId.get(tour.id); // a saved walk-through of a feature the guide no longer has: nothing
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "F1") { e.preventDefault(); toggleBot(); } };
    document.addEventListener("keydown", k);
    // a walk-through going on (it moved here through a link): carry on once the page has rendered
    const saved = readTour();
    const tm = saved ? setTimeout(() => setTour(saved), 300) : undefined;
    return () => { document.removeEventListener("keydown", k); clearTimeout(tm); };
  }, []);
  function start(f: Feature) {
    setBot({ open: false });
    const s = { id: f.id, from: module, i: 0 };
    saveTour(s);
    setTimeout(() => setTour(s), 200); // after the panel's exit
  }
  const [w, h] = vp.split(" ").map(Number);
  const at = drag ?? (vp ? spot(parseDock(dock), size, w, h) : null);
  const drop = (e: React.PointerEvent<HTMLElement>) => {
    grab.current = null;
    if (!drag) return;
    dragged.current = true;
    setPref("botCorner", snap(drag.x + size / 2, drag.y + size / 2, w, h));
    setDrag(null); // glides onto that edge (globals.css: button.gb-orb's left / top transition), then lands
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) e.currentTarget.animate(LAND, { duration: 600, delay: 380, easing: "ease-out" });
  };
  const botIcon = { s: "size-6", m: "size-8", l: "size-10" }[sizeId];
  const ask = t("Hỏi bất cứ điều gì về app: tính năng, rule, vì sao một nút ẩn / hiện (F1).");
  // the floating bot's centre: where the chat opens on its side of the screen (from: the bot it was opened from)
  const box = vp ? panelBox(mode, from ?? (at && { x: at.x + size / 2, y: at.y + size / 2 }), w, h) : null;
  return (
    <>
      {show && mode === "bar" && (
        <Hint side="bottom" title={t("Trợ lý biết tuốt")} text={ask}>
          <button type="button" data-gb-launcher aria-label={t("Hỏi trợ lý biết tuốt")} aria-expanded={open} onClick={toggleBot}
            className="gb-orb gb-still relative grid size-8 shrink-0 place-items-center">
            <Orb px={32} bot="size-6" />
          </button>
        </Hint>
      )}
      {show && mode === "side" && !open && vp && (
        <Hint side="bottom" title={t("Trợ lý biết tuốt")} text={ask}>
          <button type="button" data-gb-launcher aria-label={t("Hỏi trợ lý biết tuốt")} onClick={toggleBot}
            style={{ left: w - size - 8, top: 44 + (h - 44 - size) / 2, width: size, height: size }}
            className="gb-orb gb-still gb-peek fixed z-[55] grid place-items-center">
            <Orb px={size} bot={botIcon} ping />
          </button>
        </Hint>
      )}
      {show && mode === "float" && !open && at && (
        <Hint title={t("Trợ lý biết tuốt")} text={t("Hỏi bất cứ điều gì về app: tính năng, rule, vì sao một nút ẩn / hiện. Kéo tới bất kỳ chỗ nào sát mép màn hình (F1).")}>
          <button type="button" data-gb-launcher aria-label={t("Hỏi trợ lý biết tuốt")} style={{ left: at.x, top: at.y, width: size, height: size }}
            className={cn("gb-orb fixed z-[55] grid touch-none place-items-center", drag && "gb-drag")}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); grab.current = { dx: e.clientX - at.x, dy: e.clientY - at.y, x0: e.clientX, y0: e.clientY }; }}
            onPointerMove={(e) => {
              const g = grab.current;
              if (!g || (!drag && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 5)) return;
              setDrag({ x: fit(e.clientX - g.dx, 0, w - size), y: fit(e.clientY - g.dy, 0, h - size) });
            }}
            onPointerUp={drop} onPointerCancel={drop}
            onClick={() => { if (!dragged.current) toggleBot(); dragged.current = false; }}>
            <Orb px={size} bot={botIcon} ping />
          </button>
        </Hint>
      )}
      <AnimatePresence>
        {open && box && <Bot key="bot" cat={cat} failed={failed} module={module} turns={turns} code={code} name={name}
          mode={mode} box={box} from={from ?? { x: box.left + box.width - 24, y: box.top + 24 }} size={mode === "bar" ? 32 : size}
          onClose={() => setBot({ open: false })} onTour={start} t={t} />}
      </AnimatePresence>
      {tour && touring && <GuideTour key={tour.id} f={touring} from={tour.from} start={tour.i} onEnd={() => setTour(null)} />}
    </>
  );
}

/** Questions to start from, for the module you are on. */
const STARTERS: Record<Module, Key[]> = {
  telegram: ["Làm sao tóm tắt một nhóm?", "Vì sao một tin không hiện trong Việc cần xử lý?", "Giao việc cho AI Agent thế nào?"],
  youtrack: ["Làm sao tạo ticket từ tin Telegram?", "Vì sao ticket không hiện trên Dashboard?", "Báo cáo release tự chạy khi nào?"],
  settings: ["Đổi model AI cho tóm tắt ở đâu?", "Bật thông báo khi có tag mới thế nào?", "Cập nhật app ra sao?"],
};

/** The panel's opening: a circle the size of the bot, centred on it (`from`, viewport px), that grows to show the whole
 *  panel (closing: shrinks back into the bot, which pops in again). In px, so motion can tween it. */
function reveal(box: Box, from: Pt, size: number) {
  const x = from.x - box.left, y = from.y - box.top;
  const far = Math.max(Math.hypot(x, y), Math.hypot(box.width - x, y), Math.hypot(x, box.height - y), Math.hypot(box.width - x, box.height - y));
  const at = (r: number) => `circle(${r}px at ${x}px ${y}px)`;
  return { closed: at(size / 2), open: at(far + 60), origin: `${x}px ${y}px` }; // + the shadow's reach
}

function Bot({ cat, failed, module, turns, code, name, mode, box, from, size, onClose, onTour, t }: {
  cat: Catalog | null; failed: boolean; module: Module; turns: Turn[]; code: boolean; name: string;
  mode: BotMode; box: Box; from: Pt; size: number; onClose: () => void; onTour: (f: Feature) => void; t: T;
}) {
  const [q, setQ] = useState("");
  const [live, setLive] = useState<Turn | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const { ref: feedRef, onScroll } = useFollow(live?.a ?? turns.length, turns.length);

  // ponytail: a question in flight stops when the page reloads or changes (the panel remounts); a background job if that bites
  async function ask(text: string) {
    const question = text.trim();
    if (!question || !cat || live) return;
    setQ("");
    const ctl = (abort.current = new AbortController());
    setLive({ q: question, a: "" });
    try {
      const history = turns.filter((x) => !x.error).slice(-6).map(({ q, a }) => ({ q, a: a.slice(0, 8000) }));
      const r = await apiStream<{ text: string }>("/ai/guide", { question, guide: cat.text, history, page: location.pathname + location.search + location.hash, code },
        ctl.signal, (a) => setLive({ q: question, a }));
      setBot({ turns: [...BOT_STATE.turns, { q: question, a: r.text }] });
    } catch (e) {
      const map = Object.fromEntries(Object.entries(AI_ERR).map(([k, v]) => [k, t(v)]));
      if (ctl.signal.aborted) setQ(question); // stopped: the question goes back in the box
      else setBot({ turns: [...BOT_STATE.turns, { q: question, a: "", error: errorText(e, map, t("AI không trả lời được.")) }] });
    } finally {
      if (abort.current === ctl) { abort.current = null; setLive(null); }
    }
  }
  const go = (href: string) => { setBot({ open: false }); location.assign(href); };
  const still = useReducedMotion();
  const clip = reveal(box, from, size);
  // fixed at the right: slides in like a drawer; otherwise it grows out of the bot
  const anim = still ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : mode === "side" ? {
      initial: { x: box.width + 40 },
      animate: { x: 0, transition: { type: "spring" as const, stiffness: 260, damping: 28 } },
      exit: { x: box.width + 40, transition: { duration: 0.28, ease: [0.7, 0, 0.84, 0] as const } },
    } : {
      initial: { clipPath: clip.closed, scale: 0.96 },
      animate: { clipPath: clip.open, scale: 1, transition: { clipPath: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }, scale: { type: "spring" as const, stiffness: 320, damping: 22 } } },
      exit: { clipPath: clip.closed, scale: 0.96, transition: { duration: 0.32, ease: [0.7, 0, 0.84, 0] as const } },
    };
  const you = name ? shortName(name) : t("anh/chị");

  return (
    <motion.section role="dialog" aria-label={t("Trợ lý biết tuốt")} {...anim}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, transformOrigin: clip.origin }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } }}
      className="fixed z-[55] flex flex-col gap-3 rounded-3xl border border-rule-2 bg-paper p-4 shadow-pop">
      <header className="gb-hero relative -mx-4 -mt-4 flex items-center gap-3 overflow-hidden rounded-t-3xl border-b border-rule px-4 py-3">
        <span aria-hidden className="gb-blob -top-6 -left-4 size-20 bg-hl" />
        <span aria-hidden className="gb-blob -right-6 -bottom-8 size-24 bg-info" style={{ "--gx": "-40px", "--gy": "-10px", animationDelay: "-3s" } as CSSProperties} />
        <span className="gb-orb relative z-10 grid size-12 shrink-0 place-items-center"><Orb px={48} bot="size-9" busy={!!live} /></span>
        <div className="relative z-10 min-w-0 flex-1">
          <h2 className="text-base font-bold text-ink">{t("Trợ lý biết tuốt")}</h2>
          <p className="flex items-center gap-1.5 truncate text-xs text-ink-2" aria-live="polite">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", live ? "bg-hl" : "gb-online bg-ok")} />
            {live ? t("Em đang tìm câu trả lời…") : name ? t("Sẵn sàng giúp {name}", { name: you }) : t("Sẵn sàng giúp anh/chị")}
          </p>
        </div>
        <span className="relative z-10 flex items-center">
          {turns.length > 0 && (
            <Hint side="bottom" title={t("Cuộc hỏi mới")} text={t("Xóa các lượt hỏi trước, bắt đầu lại.")}>
              <Button size="icon-sm" variant="ghost" aria-label={t("Cuộc hỏi mới")} onClick={() => { abort.current?.abort(); setBot({ turns: [] }); }}><RotateCcw /></Button>
            </Hint>
          )}
          <Button size="icon-sm" variant="ghost" aria-label={t("Đóng")} onClick={onClose} className="transition-transform hover:rotate-90"><X /></Button>
        </span>
      </header>
      <div ref={feedRef} onScroll={onScroll} aria-live="polite" className="-mx-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto px-4 pb-1">
        <div className="gb-in flex items-start gap-2" style={{ animationDelay: "0.25s" }}>
          <AiBot className="size-7 shrink-0" />
          <p className="rounded-2xl rounded-tl-sm border border-hl/20 bg-hl-wash px-3 py-2 text-sm leading-relaxed text-ink">
            {t("Chào {name}! 👋 Em biết mọi tính năng, rule và chỗ ẩn / hiện của Radar. Hỏi em gì cũng được nha: em chỉ cách làm rồi dẫn tới tận nơi.", { name: you })}
          </p>
        </div>
        {!turns.length && !live && (
          <div className="flex flex-wrap gap-1.5 pl-9">
            {STARTERS[module].map((s, i) => (
              <button key={s} type="button" disabled={!cat} onClick={() => ask(t(s))} style={{ animationDelay: `${0.4 + i * 0.08}s` }}
                className="gb-in rounded-full border border-rule-2 bg-cotton px-3 py-1 text-left text-xs text-ink shadow-stock transition-[translate,border-color,background-color] duration-(--dur-short) hover:-translate-y-0.5 hover:border-hl hover:bg-hl-wash disabled:opacity-50">{t(s)}</button>
            ))}
          </div>
        )}
        {[...turns, ...(live ? [live] : [])].map((x, i) => (
          <Answer key={i} turn={x} busy={x === live} byId={cat?.byId} code={code} t={t} onTour={onTour} onGo={go} />
        ))}
        {!cat && failed && <p role="alert" className="text-sm text-error">{t("Không tải được hướng dẫn, thử mở lại.")}</p>}
      </div>
      <AiPromptBox value={q} onChange={setQ} onSend={() => ask(q)} running={!!live} onStop={() => abort.current?.abort()} autoFocus maxLength={500}
        aria-label={t("Hỏi trợ lý biết tuốt")} placeholder={t("Hỏi gì cũng được: vì sao không thấy nút Gửi?")}
        actions={!live && <AiSend onClick={() => ask(q)} disabled={!q.trim() || !cat} />} />
    </motion.section>
  );
}

const LINK = /\[([^\]\n]{1,80})\]\((\/[^)\s]*)\)/g; // a page of the app the AI links to (GUIDE_PROMPT lists them)
const REF = /\s*\[([a-z0-9-]+)\]/g; // a feature of the guide, by id
const PART = /\[(?![^\n]*\))[^\n]*$/; // a link / [id] still being written: shown once it is whole

/** One turn: your question, then the bot searching, answering, and the buttons that take you there — open the page it
 *  linked, or walk through a feature it named, lit on the page. */
function Answer({ turn, busy, byId, code, t, onTour, onGo }: {
  turn: Turn; busy: boolean; byId?: Catalog["byId"]; code: boolean; t: T; onTour: (f: Feature) => void; onGo: (href: string) => void;
}) {
  const links = [...new Map([...turn.a.matchAll(LINK)].map((m) => [m[2], m[1]]))];
  const refs = [...new Set([...turn.a.matchAll(REF)].map((m) => m[1]))].flatMap((id) => byId?.get(id) ?? []);
  const text = turn.a.replace(LINK, "**$1**").replace(REF, (m, id) => (byId?.has(id) ? "" : m));
  const lines = [t("Đang tìm trong hướng dẫn"), ...(code ? [t("Đang đọc code của app")] : []), t("Đang soạn cách làm")];
  return (
    <>
      <UserBubble>{turn.q}</UserBubble>
      {turn.error ? <AiResultCard error>{turn.error}</AiResultCard>
        : busy && !text ? <AiThinking lines={lines} />
        : (
          <AiResultCard title={t("Cách làm")} busy={busy} actions={!busy && (refs.length > 0 || links.length > 0) && (
            <div className="flex w-full flex-wrap gap-1.5">
              {refs.map((f, i) => (
                <Hint key={f.id} side="bottom" title={t("Chỉ tôi tận nơi")} text={t("Mở đúng trang và làm sáng từng nút cần bấm.")}>
                  <Button size="sm" variant={i === 0 ? "default" : "outline"} aria-label={t("Chỉ cho tôi: {title}", { title: f.title })} onClick={() => onTour(f)}>
                    <MousePointerClick />{f.title}
                  </Button>
                </Hint>
              ))}
              {links.map(([href, label]) => (
                <Button key={href} size="sm" variant="outline" onClick={() => onGo(href)}><ArrowUpRight />{t("Mở {page}", { page: label })}</Button>
              ))}
            </div>
          )}>
            <Markdown text={busy ? text.replace(PART, "") : text} />
          </AiResultCard>
        )}
    </>
  );
}
