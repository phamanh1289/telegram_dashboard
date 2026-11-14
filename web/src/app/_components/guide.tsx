"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, ChevronDown, MousePointerClick, RotateCcw, Search, Send, Settings, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { type CSSProperties, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AiBot, AiBubble, AiPromptBox, AiSend, AiThinking, UserBubble, useFollow } from "@/shared/components/ai/chat";
import { Markdown } from "@/shared/components/markdown";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { GuideBulb, Hint } from "@/shared/components/ui/hint";
import { Segmented } from "@/shared/components/ui/segmented";
import { YtLogo } from "@/shared/components/yt-logo";
import { useTodayWork, workText } from "@/features/telegram/components/today-page";
import { apiStream, errorText, statusQuery } from "@/shared/lib/api";
import { type Key, type Lang, type T, tr, useLang, useT } from "@/shared/lib/i18n";
import { fold } from "@/shared/lib/utils";
import { BOT_SIZES, type BotCorner, type BotMode, readYtRole, setPref, useBotCode, useBotDock, useBotMode, useBotShow, useBotSize } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { shortName, ytMeQuery } from "@/features/youtrack/lib/yt";
import { GuideTour, readTour, saveTour, type TourState } from "./guide-tour";

// In-app user guide as a floating "know-it-all" bot: a chat with the AI over every feature of the Telegram / YouTrack tabs
// (shared/lib/guide/vi, English: shared/lib/guide/en) and, when allowed, the app's own code; each answer ends in buttons that take
// you there: open the page, or a live walk-through of the feature's steps on the page (guide-tour). The top bar's light
// bulb opens the same guide to browse (Guide), no AI.

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

/** A feature as the AI reads it: `name` ([id] and where it is) alone in the index, with `full` (what it does, its steps) when it matches the question. */
type Entry = { f: Feature; name: string; full: string; title: string; head: string; top: Set<string>; body: Set<string> };
/** One language's guide: the features by id, and each one ready to rank against a question. */
type Catalog = { byId: Map<string, Feature>; all: Entry[]; rare: (word: string) => number };
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
// words every question has: they match nothing in particular
const STOP = new Set("lam sao vi the nao o dau la gi co khong duoc cho toi minh cua va de khi mot cac nhung thi ma bi thay em anh chi how do i the a an to is are why what where can in on of my it".split(" "));
function build(all: Feature[], lang: Lang): Catalog {
  const entries = all.map((f): Entry => {
    const name = `[${f.id}] ${tr(lang, TAB[f.tab])} › ${f.area} › ${f.title}`, head = `${f.title} ${f.area} ${f.keys ?? ""}`;
    const how = f.how.map((h, i) => `${i + 1}) ${stepText(h)}`).join(" ");
    return { f, name, full: `${name}: ${f.what} ${tr(lang, "Cách dùng:")} ${how}`, title: ` ${words(f.title).join(" ")} `, head: ` ${words(head).join(" ")} `, top: new Set(words(head)), body: new Set(words(`${f.what} ${how}`)) };
  });
  const df = new Map<string, number>(); // how many features have a word: a rare one ("dashboard") says more than a common one ("ticket")
  for (const e of entries) for (const w of new Set([...e.top, ...e.body])) df.set(w, (df.get(w) ?? 0) + 1);
  return { byId: new Map(all.map((f) => [f.id, f])), all: entries, rare: (w) => Math.log(1 + entries.length / (df.get(w) ?? entries.length)) };
}
/** The features a question is about, best first: its words in a feature's title (5), area / keys (3), or text (1), rare
 *  words counting more, and word pairs in the title (6) or keys (4) (Vietnamese words are mostly two syllables). `strict`
 *  (the chips shown while typing): as good as every word in the title / keys, so a vague question (folded "cái này" also
 *  reads "cài", "nay") shows none. */
function rank(cat: Catalog, text: string, n: number, strict = false): Feature[] {
  const all = words(text), terms = all.filter((w) => w.length > 1 && !STOP.has(w));
  if (!terms.length) return [];
  const pairs = all.slice(1).map((w, i) => ` ${all[i]} ${w} `).filter((p) => !p.trim().split(" ").every((w) => STOP.has(w)));
  return cat.all.map((e) => {
    let raw = 0, s = 0;
    for (const w of terms) { const p = e.title.includes(` ${w} `) ? 5 : e.top.has(w) ? 3 : e.body.has(w) ? 1 : 0; raw += p; s += p * cat.rare(w); }
    for (const p of pairs) { const v = e.title.includes(p) ? 6 : e.head.includes(p) ? 4 : 0; raw += v; s += v; }
    return { f: e.f, raw, s };
  }).filter((x) => x.raw >= (strict ? 3 * terms.length : 3)).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.f);
}
const SENT = 12; // features sent whole with a question
/** The guide a question is answered from (`ids`: the features sent whole): the features it (and the turn before) is about,
 *  whole, then every other one by name only — a sixth of the whole guide. Too few matches (a vague question): the whole
 *  guide. `seen` (a session carried on, which holds those already): only the matches it has not got yet. */
function guideFor(cat: Catalog, question: string, last?: Pick<Turn, "q" | "a">, seen?: string[]) {
  const hits = new Set([...rank(cat, `${question} ${last?.q ?? ""}`, SENT), ...[...(last?.a ?? "").matchAll(REF)].flatMap((m) => cat.byId.get(m[1]) ?? [])]);
  const whole = seen ? cat.all.filter((e) => hits.has(e.f) && !seen.includes(e.f.id)) : hits.size < 3 ? cat.all : cat.all.filter((e) => hits.has(e.f));
  const rest = seen || whole.length === cat.all.length ? [] : [INDEX, ...cat.all.filter((e) => !hits.has(e.f)).map((e) => e.name)];
  return { text: [...whole.map((e) => e.full), ...rest].join("\n"), ids: whole.map((e) => e.f.id) };
}
const SESSION = 8; // turns one AI session answers before the next starts over (the session grows with every turn)
const INDEX = "--- Tính năng khác (chỉ có tên, không có bước) ---"; // GUIDE_PROMPT (app.py) names this line
const REF = /\s*\[([a-z0-9-]+)\]/g; // a feature of the guide, by id
// the guide is big: each language loads on first use, not with the app shell
const LOAD: Record<Lang, () => Promise<{ default: unknown }>> = { vi: () => import("@/shared/lib/guide/vi"), en: () => import("@/shared/lib/guide/en") };
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
const EXIT = 0.2; // seconds the chat takes to close
const GAP = 16, TOP = 56; // GAP: the floating bot's margin on every edge; TOP: the chat panel's, under the top bar
// bot and chat: z-[55], over the side panel and dialogs (z-50), under the toast (z-[60]) and the walk-through (z-[70])
type Pt = { x: number; y: number };
/** `from`: the centre of the bot the chat opened from (it grows out of it, and shrinks back into it). `sid`: the AI session
 *  that answered last (Claude's CLI; a follow-up carries it on), `seen`: the features it was sent whole. */
type BotState = { open: boolean; turns: Turn[]; from?: Pt | null; sid?: string; seen?: string[]; ask?: string };
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
  const st = useQuery({ ...statusQuery, staleTime: Infinity }).data; // the shell keeps it fresh
  // what is set up on this machine, so "why can't I see…" is answered for this user (not UI text: the AI reads it)
  const state = st ? `Telegram: ${st.state}; AI: ${st.ai_configured ? "đã cấu hình" : "chưa cấu hình"}; YouTrack: ${st.youtrack_configured ? "đã cấu hình" : "chưa cấu hình"}; vai trò: ${readYtRole() ?? "chưa chọn"}` : "";
  const [warm, setWarm] = useState(false); // the pointer / focus reached the bot: the guide loads before the chat opens, not during its opening
  const warmUp = { onPointerEnter: () => setWarm(true), onFocus: () => setWarm(true) };
  const [book, setBook] = useState(false); // the header's guide: every feature to browse, no AI
  const { cat, failed } = useCatalog(open || !!tour || warm || book);
  const touring = tour && cat?.byId.get(tour.id); // a saved walk-through of a feature the guide no longer has: nothing
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "F1") { e.preventDefault(); toggleBot(); }
      // Esc with the focus outside the chat closes it too; in another popup or a field, Esc is theirs (in the chat: its own handler)
      else if (e.key === "Escape" && BOT_STATE.open && !e.defaultPrevented
        && !document.activeElement?.closest("[role=dialog], [role=menu], [role=listbox], input, textarea, [contenteditable]")) setBot({ open: false });
    };
    document.addEventListener("keydown", k);
    // a walk-through going on (it moved here through a link): carry on once the page has rendered
    const saved = readTour();
    const tm = saved ? setTimeout(() => setTour(saved), 300) : undefined;
    return () => { document.removeEventListener("keydown", k); clearTimeout(tm); };
  }, []);
  // closed: the focus the chat held goes back to the bot it opened from
  const wasOpen = useRef(open);
  useEffect(() => {
    const a = document.activeElement;
    if (wasOpen.current && !open && (!a || a === document.body || a.closest("[data-gb-panel]")))
      document.querySelector<HTMLElement>("[data-gb-launcher]")?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  function start(f: Feature) {
    setBot({ open: false });
    setBook(false);
    const s = { id: f.id, from: module, i: 0 };
    saveTour(s);
    setTimeout(() => setTour(s), EXIT * 1000); // after the panel's exit
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
  // nothing in the guide matched: the question goes to the bot, once the dialog has closed
  const askBot = (q: string) => { setBook(false); setTimeout(() => { setBot({ ask: q }); if (!BOT_STATE.open) toggleBot(); }, EXIT * 1000); };
  return (
    <>
      <Hint side="bottom" title={t("Hướng dẫn")} text={t("Duyệt mọi tính năng Telegram / YouTrack / Cài đặt: cách dùng từng bước, hoặc để app chỉ trực tiếp trên màn hình.")}>
        <Button size="icon-sm" variant="ghost" aria-label={t("Hướng dẫn sử dụng")} onClick={() => setBook(true)}><GuideBulb className="size-5" /></Button>
      </Hint>
      <Dialog open={book} onOpenChange={setBook}>
        <DialogContent className="flex h-[min(88dvh,50rem)] flex-col gap-3 sm:max-w-2xl">
          {book && <Guide cat={cat} failed={failed} onTour={start} onAsk={askBot} t={t} />}
        </DialogContent>
      </Dialog>
      {show && mode === "bar" && (
        <Hint side="bottom" title={t("Trợ lý biết tuốt")} text={ask}>
          <button type="button" data-gb-launcher aria-label={t("Hỏi trợ lý biết tuốt")} aria-expanded={open} onClick={toggleBot} {...warmUp}
            className="gb-orb gb-still relative grid size-8 shrink-0 place-items-center">
            <Orb px={32} bot="size-6" />
          </button>
        </Hint>
      )}
      {show && mode === "side" && vp && (
        <Hint side="bottom" title={t("Trợ lý biết tuốt")} text={ask}>
          <button type="button" data-gb-launcher aria-label={t("Hỏi trợ lý biết tuốt")} onClick={toggleBot} inert={open} {...warmUp}
            style={{ left: w - size - 8, top: 44 + (h - 44 - size) / 2, width: size, height: size }}
            className={cn("gb-orb gb-still gb-peek fixed z-[55] grid place-items-center", open && "gb-away")}>
            <Orb px={size} bot={botIcon} ping />
          </button>
        </Hint>
      )}
      {show && mode === "float" && at && (
        <Hint title={t("Trợ lý biết tuốt")} text={t("Hỏi bất cứ điều gì về app: tính năng, rule, vì sao một nút ẩn / hiện. Kéo tới bất kỳ chỗ nào sát mép màn hình (F1).")}>
          <button type="button" data-gb-launcher aria-label={t("Hỏi trợ lý biết tuốt")} style={{ left: at.x, top: at.y, width: size, height: size }} inert={open} {...warmUp}
            className={cn("gb-orb fixed z-[55] grid touch-none place-items-center", drag && "gb-drag", open && "gb-away")}
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
        {open && box && <Bot key="bot" cat={cat} failed={failed} module={module} turns={turns} code={code} name={name} state={state}
          mode={mode} box={box} from={from ?? { x: box.left + box.width - 24, y: box.top + 24 }}
          onClose={() => setBot({ open: false })} onTour={start} t={t} />}
      </AnimatePresence>
      {tour && touring && <GuideTour key={tour.id} f={touring} from={tour.from} start={tour.i} onEnd={() => setTour(null)} />}
    </>
  );
}

/** A chip in the chat: a question to start from, a feature that matches what is being typed. */
const CHIP = "rounded-full border border-rule-2 bg-cotton px-3 py-1 text-left text-xs text-ink shadow-stock transition-[translate,border-color,background-color] duration-(--dur-short) hover:-translate-y-0.5 hover:border-hl hover:bg-hl-wash disabled:opacity-50";
/** Questions to start from, for the module you are on. */
const STARTERS: Record<Module, Key[]> = {
  telegram: ["Làm sao tóm tắt một nhóm?", "Vì sao một tin không hiện trong Việc cần xử lý?", "Giao việc cho AI Agent thế nào?"],
  youtrack: ["Làm sao tạo ticket từ tin Telegram?", "Vì sao ticket không hiện trên Dashboard?", "Báo cáo release tự chạy khi nào?"],
  settings: ["Đổi model AI cho tóm tắt ở đâu?", "Bật thông báo khi có tag mới thế nào?", "Cập nhật app ra sao?"],
};

function Bot({ cat, failed, module, turns, code, name, state, mode, box, from, onClose, onTour, t }: {
  cat: Catalog | null; failed: boolean; module: Module; turns: Turn[]; code: boolean; name: string; state: string;
  mode: BotMode; box: Box; from: Pt; onClose: () => void; onTour: (f: Feature) => void; t: T;
}) {
  const [q, setQ] = useState("");
  const [live, setLive] = useState<Turn | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const { ref: feedRef, onScroll } = useFollow(live?.a ?? turns.length, turns.length);
  const work = useTodayWork(); // "còn tin nào chờ?": Hôm nay's list, read while the panel is open (mostly the shell's cache)

  // ponytail: a question in flight stops when the page reloads or changes (the panel remounts); a background job if that bites
  async function ask(text: string) {
    const question = text.trim();
    if (!question || !cat || live) return;
    setQ("");
    const ctl = (abort.current = new AbortController());
    setLive({ q: question, a: "" });
    try {
      const history = turns.filter((x) => !x.error).slice(-6).map(({ q, a }) => ({ q, a: a.slice(0, 8000) }));
      // a follow-up carries the AI session on: only the features it has not got, no history (it holds both)
      const run = async (sid?: string) => {
        const g = guideFor(cat, question, history.at(-1), sid ? (BOT_STATE.seen ?? []) : undefined);
        const r = await apiStream<{ text: string; sid?: string }>("/ai/guide", { question, guide: g.text, history: sid ? [] : history, page: location.pathname + location.search + location.hash, code, name, state, sid, work: workText(work, t).slice(0, 12_000) },
          ctl.signal, (a) => setLive({ q: question, a }));
        return { text: r.text, sid: r.sid || undefined, seen: [...(sid ? (BOT_STATE.seen ?? []) : []), ...g.ids] };
      };
      const sid = BOT_STATE.turns.length % SESSION ? BOT_STATE.sid : undefined;
      const r = await run(sid).catch((e) => {
        if (!sid || ctl.signal.aborted) throw e;
        setLive({ q: question, a: "" });
        return run(); // the session is gone (cleaned up, another AI picked, "Đọc code" switched): once more, whole
      });
      setBot({ turns: [...BOT_STATE.turns, { q: question, a: r.text }], sid: r.sid, seen: r.seen });
    } catch (e) {
      const map = Object.fromEntries(Object.entries(AI_ERR).map(([k, v]) => [k, t(v)]));
      if (ctl.signal.aborted) setQ(question); // stopped: the question goes back in the box
      else setBot({ turns: [...BOT_STATE.turns, { q: question, a: "", error: errorText(e, map, t("AI không trả lời được.")) }] });
    } finally {
      if (abort.current === ctl) { abort.current = null; setLive(null); }
    }
  }
  // a question handed over from the header's guide (askBot): asked once the guide has loaded
  const pending = useBot().ask;
  useEffect(() => {
    const p = BOT_STATE.ask; // the store, not the render's `pending`: a second run of this effect finds it taken
    if (p && cat && !live) { setBot({ ask: undefined }); queueMicrotask(() => ask(p)); }
  }, [pending, cat, live]); // eslint-disable-line react-hooks/exhaustive-deps -- ask is fresh each render
  const router = useRouter();
  /** Open a page of the app without reloading it: another module mounts and reads the URL; Cài đặt follows the hash; the
   *  module you are on switches its view ("guide-go": inbox.tsx, yt/state.tsx). */
  const go = (href: string) => {
    setBot({ open: false });
    const u = new URL(href, location.origin), path = (p: string) => p.replace(/\/$/, "");
    if (path(u.pathname) !== path(location.pathname)) router.push(href);
    else if (u.hash) location.hash = u.hash;
    else dispatchEvent(new CustomEvent("guide-go", { detail: u.searchParams }));
  };
  const still = useReducedMotion();
  // fixed at the right: slides in like a drawer; otherwise it grows out of the bot (`from`) and shrinks back into it, the
  // bot fading the other way (globals.css gb-away). Transform + opacity only: the compositor runs them, no repaint per frame.
  const spring = { type: "spring" as const, stiffness: 420, damping: 34 };
  const out = { duration: EXIT, ease: [0.4, 0, 1, 1] as const };
  const anim = still ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : mode === "side" ? {
      initial: { x: box.width + 40 },
      animate: { x: 0, transition: spring },
      exit: { x: box.width + 40, transition: out },
    } : {
      initial: { opacity: 0, scale: 0.5 },
      animate: { opacity: 1, scale: 1, transition: { scale: spring, opacity: { duration: 0.16 } } },
      exit: { opacity: 0, scale: 0.5, transition: out },
    };
  const you = name ? shortName(name) : t("anh/chị");
  // while typing: the features the words match, at once and with no AI — a click walks through it on the page
  const hits = cat && !live ? rank(cat, q, 3, true) : [];

  return (
    <motion.section role="dialog" data-gb-panel aria-label={t("Trợ lý biết tuốt")} {...anim}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, transformOrigin: `${from.x - box.left}px ${from.y - box.top}px` }}
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
              <Button size="icon-sm" variant="ghost" aria-label={t("Cuộc hỏi mới")} onClick={() => { abort.current?.abort(); setBot({ turns: [], sid: undefined, seen: undefined }); }}><RotateCcw /></Button>
            </Hint>
          )}
          <Button size="icon-sm" variant="ghost" aria-label={t("Đóng")} onClick={onClose} className="transition-transform hover:rotate-90"><X /></Button>
        </span>
      </header>
      <div ref={feedRef} onScroll={onScroll} aria-live="polite" className="-mx-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto px-4 pb-1">
        <AiBubble className="gb-in" style={{ animationDelay: "0.25s" }}>
          <p>{t("Chào {name}! 👋 Em biết mọi tính năng, rule và chỗ ẩn / hiện của Radar. Hỏi em gì cũng được nha: em chỉ cách làm rồi dẫn tới tận nơi.", { name: you })}</p>
        </AiBubble>
        {!turns.length && !live && (
          <div className="flex flex-wrap gap-1.5 pl-9">
            {STARTERS[module].map((s, i) => (
              <button key={s} type="button" disabled={!cat} onClick={() => ask(t(s))} style={{ animationDelay: `${0.4 + i * 0.08}s` }}
                className={cn("gb-in", CHIP)}>{t(s)}</button>
            ))}
          </div>
        )}
        {[...turns, ...(live ? [live] : [])].map((x, i) => (
          <Answer key={i} turn={x} busy={x === live} byId={cat?.byId} code={code} t={t} onTour={onTour} onGo={go} />
        ))}
        {!cat && failed && <p role="alert" className="text-sm text-error">{t("Không tải được hướng dẫn, thử mở lại.")}</p>}
      </div>
      {hits.length > 0 && (
        <div className="-mb-1 flex flex-wrap gap-1.5">
          {hits.map((f) => (
            <Hint key={f.id} title={t("Chỉ tôi tận nơi")} text={t("Mở đúng trang và làm sáng từng nút cần bấm.")}>
              <button type="button" aria-label={t("Chỉ cho tôi: {title}", { title: f.title })} onClick={() => onTour(f)} className={cn("flex items-center gap-1", CHIP)}>
                <MousePointerClick className="size-3.5 shrink-0 text-hl-2" />{f.title}
              </button>
            </Hint>
          ))}
        </div>
      )}
      <AiPromptBox value={q} onChange={setQ} onSend={() => ask(q)} running={!!live} onStop={() => abort.current?.abort()} autoFocus maxLength={500}
        aria-label={t("Hỏi trợ lý biết tuốt")} placeholder={t("Hỏi gì cũng được: còn tin nào chờ tôi? vì sao không thấy nút Gửi?")}
        actions={!live && <AiSend onClick={() => ask(q)} disabled={!q.trim() || !cat} />} />
    </motion.section>
  );
}

const TAB_LOOK: Record<Tab, { Icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  telegram: { Icon: Send, tone: "bg-info-wash text-info" },
  youtrack: { Icon: YtLogo, tone: "bg-hl-wash text-hl-2" },
  settings: { Icon: Settings, tone: "bg-paper-3 text-ink-2" },
};

/** The header's guide: every feature, searched as you type (the bot's `rank`), each with its steps and a walk-through on
 *  the page; nothing matches → the question goes to the bot. */
function Guide({ cat, failed, onTour, onAsk, t }: { cat: Catalog | null; failed: boolean; onTour: (f: Feature) => void; onAsk: (q: string) => void; t: T }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDeferredValue(q).trim();
  const hits = useMemo(() => !cat ? [] : (dq ? rank(cat, dq, cat.all.length) : cat.all.map((e) => e.f)).filter((f) => tab === "all" || f.tab === tab), [cat, dq, tab]);
  return (
    <>
      <DialogTitle className="flex items-center gap-2"><GuideBulb className="size-5" />{t("Hướng dẫn sử dụng")}</DialogTitle>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Tìm tính năng")} placeholder={t("Tìm tính năng: tóm tắt nhóm, tạo ticket…")}
          className="h-9 w-full rounded-md border border-rule-2 bg-cotton pr-3 pl-8 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3" />
      </div>
      <Segmented id="guide-tab" label={t("Khu vực")} value={tab} onChange={setTab} className="self-start"
        items={[{ value: "all", label: t("Tất cả") }, { value: "telegram", label: "Telegram" }, { value: "youtrack", label: "YouTrack" }, { value: "settings", label: t("Cài đặt") }]} />
      <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5 pb-1">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
          <BookOpen className="size-3.5 text-ink-3" aria-hidden />{dq ? t("Tính năng phù hợp") : t("Mọi tính năng")} <span className="font-mono font-normal text-ink-3 tabular-nums">{hits.length}</span><span className="h-px flex-1 bg-rule" />
        </h3>
        {!cat ? (
          failed && <p role="alert" className="py-6 text-center text-sm text-error">{t("Không tải được hướng dẫn, thử mở lại.")}</p>
        ) : hits.length === 0 ? (
          <div className="grid justify-items-center gap-3 py-6 text-center text-sm text-ink-3">
            <p>{t("Không tìm thấy tính năng khớp.")}</p>
            {dq && <Button size="sm" variant="outline" className="rounded-full" onClick={() => onAsk(dq)}><AiBot className="size-4" />{t("Hỏi trợ lý biết tuốt")}</Button>}
          </div>
        ) : (
          <ul className="grid gap-2">
            {hits.map((f) => <Item key={f.id} f={f} on={open === f.id} toggle={() => setOpen(open === f.id ? null : f.id)} onTour={onTour} t={t} />)}
          </ul>
        )}
      </div>
    </>
  );
}

function Item({ f, on, toggle, onTour, t }: { f: Feature; on: boolean; toggle: () => void; onTour: (f: Feature) => void; t: T }) {
  const tb = TAB_LOOK[f.tab];
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (on) setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 220); }, [on]);
  return (
    <li ref={ref} className={cn("rounded-lg border bg-cotton transition-[border-color,box-shadow] duration-(--dur-short)", on ? "border-hl/40 shadow-pop" : "border-rule hover:border-rule-2")}>
      <button type="button" aria-expanded={on} onClick={toggle} className="flex w-full items-start gap-3 p-3 text-left">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", tb.tone)}><tb.Icon className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">{f.title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">{t(TAB[f.tab])} › {f.area}</span>
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
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-hl-wash font-mono text-2xs font-bold text-hl-2">{i + 1}</span>
                  <span><StepText text={stepText(h)} /></span>
                </li>
              ))}
            </ol>
            <Button size="sm" className="mt-3" onClick={() => onTour(f)}><MousePointerClick />{t("Chỉ cho tôi trên màn hình")}</Button>
          </div>
        </div>
      </div>
    </li>
  );
}

const LINK = /\[([^\]\n]{1,80})\]\((\/[^)\s]*)\)/g; // a page of the app the AI links to (GUIDE_PROMPT lists them)
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
      {turn.error ? <AiBubble error><p>{turn.error}</p></AiBubble>
        : busy && !text ? <AiThinking lines={lines} />
        : (
          <AiBubble busy={busy} actions={!busy && (refs.length > 0 || links.length > 0) && <>
            {refs.map((f, i) => (
              <Hint key={f.id} side="bottom" title={t("Chỉ tôi tận nơi")} text={t("Mở đúng trang và làm sáng từng nút cần bấm.")}>
                <Button size="sm" variant={i === 0 ? "default" : "outline"} className="rounded-full" aria-label={t("Chỉ cho tôi: {title}", { title: f.title })} onClick={() => onTour(f)}>
                  <MousePointerClick />{f.title}
                </Button>
              </Hint>
            ))}
            {links.map(([href, label]) => (
              <Button key={href} size="sm" variant="outline" className="rounded-full" onClick={() => onGo(href)}><ArrowUpRight />{t("Mở {page}", { page: label })}</Button>
            ))}
          </>}>
            <Markdown text={busy ? text.replace(PART, "") : text} />
          </AiBubble>
        )}
    </>
  );
}
