"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Key, type T, readLang, useT } from "@/lib/i18n";
import { EN } from "@/lib/i18n/en";
import { fold } from "@/lib/inbox";
import { type Feature, type Module, type Step, StepText, stepText } from "./guide";

// Live guide: walks a feature's steps on the real page. Each step names its control (`at`: a UI label or `css:` selector);
// it stays lit and clickable while the rest goes dark, and clicking it moves to the next step. The walk survives a route
// change (sessionStorage), and a feature on another module starts with the click that gets there.

// [role=group]: a Segmented / filter group carries the name ("Ngưỡng WIP"), its buttons only the values; lighting the group
// still moves on when one of its buttons is clicked
const SEL = "button, a[href], [role=tab], [role=button], [role=menuitem], [role=option], [role=checkbox], [role=switch], [role=group], input, select, textarea, label, summary";
const clean = (s: string) => fold(s).replace(/\s+/g, " ").trim().replace(/(…|\.\.\.)$/, "").trim();
const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest("[data-guide-tour]"); };

/** On screen and not under something else (a sticky header): its centre hits it. */
const inView = (el: Element) => {
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
  const hit = document.elementFromPoint(x, y);
  return !hit || el.contains(hit) || hit.contains(el);
};
/** Inside the window, whatever covers it. */
const onScreen = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
const SETTLE = 20; // lookups (250 ms each) a found control is moved back on screen if it leaves it
/** Of several matches, one already on screen (a list scrolled to its newest row), else the first. The tour's own shade is see-through meanwhile. */
function pick(els: HTMLElement[]) {
  if (els.length < 2) return els[0] ?? null;
  const shade = [...document.querySelectorAll<HTMLElement>("[data-guide-tour] > *")];
  shade.forEach((n) => (n.style.pointerEvents = "none"));
  try { return els.find(inView) ?? els[0]; } finally { shade.forEach((n) => (n.style.pointerEvents = "")); }
}

/** The control a target names: `css:<selector>`, or a label — exact aria-label / text / placeholder / title first, else one that starts with it. */
export function findControl(target: string): HTMLElement | null {
  if (target.startsWith("css:")) {
    try { return pick([...document.querySelectorAll<HTMLElement>(target.slice(4))].filter(shown)); } catch { return null; }
  }
  const want = clean(target);
  const cut = want.search(/\s(n|<[^>]*>)(\s|$)/); // "Tóm tắt N tin", "Tài khoản <AI>": the part before the placeholder
  const pre = cut > 0 ? want.slice(0, cut) : want;
  if (pre.length < 2) return null;
  const exact: HTMLElement[] = [], prefix: HTMLElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(SEL)) {
    if (!shown(el)) continue;
    const names = [el.getAttribute("aria-label"), el.textContent, el.getAttribute("placeholder"), el.title].filter(Boolean).map((n) => clean(n!));
    if (names.includes(want)) exact.push(el);
    else if (pre.length >= 3 && names.some((c) => c.startsWith(pre))) prefix.push(el);
  }
  return pick(exact) ?? pick(prefix);
}

/** A Vietnamese UI label as the English UI shows it: its EN value ("N" may stand for a `{n}` placeholder); with `prefix`,
 *  the English before the first placeholder of a key that starts with it (an aria-label^= selector). */
function enLabel(v: string, prefix = false) {
  const en = (k: string) => { const e = EN[k as Key] as string | ((v: { n: string }) => string) | undefined; return typeof e === "function" ? e({ n: "N" }) : (e ?? null); };
  const hit = en(v) ?? en(v.replace(/\bN\b/g, "{n}"))?.replace(/\{n\}/g, "N");
  if (hit || !prefix) return hit;
  const k = Object.keys(EN).find((k) => k.startsWith(v) && en(k));
  return k ? en(k)!.split("{")[0].trim() || null : null;
}
/** Ways to find a target in the live language: in English, its translated labels first, then as written. */
function localized(target: string): string[] {
  if (readLang() === "vi") return [target];
  const out = target.startsWith("css:")
    ? target.replace(/((?:aria-label|title|placeholder)([\^$*]?)=)"([^"]+)"/g, (m, attr: string, op: string, v: string) => {
      const e = enLabel(v, op === "^");
      return e ? `${attr}"${e.replace(/"/g, "\\\"")}"` : m;
    })
    : (enLabel(target, true) ?? target); // a label also matches a control that starts with it (findControl)
  return out === target ? [target] : [out, target];
}
const targets = (s: Step) => (typeof s === "string" || !s.at ? [] : Array.isArray(s.at) ? s.at : [s.at]);
/** Typing / picking controls: clicking them is not the step, so they wait for "Tiếp" (a select: for a change). */
const isField = (el: HTMLElement) => el.matches("textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])");

const GO: Record<Module, { t: Key; at: string }> = {
  telegram: { t: "Bấm \"Telegram\" trên thanh trên cùng để mở Telegram.", at: "css:nav[aria-label=\"Chuyển module\"] a[href=\"/\"]" },
  youtrack: { t: "Bấm \"YouTrack\" trên thanh trên cùng để mở YouTrack.", at: "css:nav[aria-label=\"Chuyển module\"] a[href^=\"/youtrack\"]" },
  settings: { t: "Bấm biểu tượng bánh răng \"Cài đặt\" ở góc phải thanh trên cùng.", at: "css:a[href^=\"/settings\"]" },
};
/** A feature's steps, starting from module `from` (a feature elsewhere first switches module). */
export const tourSteps = (f: Feature, from: Module, t: T): Step[] => (f.tab === from ? f.how : [{ ...GO[f.tab], t: t(GO[f.tab].t) }, ...f.how]);

export const TOUR_KEY = "guide-tour";
export type TourState = { id: string; from: Module; i: number };
export function saveTour(s: TourState | null) {
  try { if (s) sessionStorage.setItem(TOUR_KEY, JSON.stringify(s)); else sessionStorage.removeItem(TOUR_KEY); } catch {}
}
export function readTour(): TourState | null {
  try { const s = JSON.parse(sessionStorage.getItem(TOUR_KEY) ?? "null"); return s?.id ? s : null; } catch { return null; }
}

const PAD = 6;

export function GuideTour({ f, from, start, onEnd }: { f: Feature; from: Module; start: number; onEnd: () => void }) {
  const t = useT();
  const steps = useMemo(() => tourSteps(f, from, t), [f, from, t.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(Math.min(start, steps.length - 1));
  // what step i's lookup found, and where it is now
  const [found, setFound] = useState<{ i: number; el: HTMLElement } | null>(null);
  const [box, setBox] = useState<{ el: HTMLElement; r: DOMRect } | null>(null);
  const [waited, setWaited] = useState(-1); // the step whose lookup has gone on a while
  const at = targets(steps[i]);
  const role = /\((Dev|QA|PO)\)/.exec(f.area)?.[1]; // a role-only feature, e.g. "Kiểm thử (QA)"
  const el =found?.i === i && found.el.isConnected ? found.el : null;
  const rect = el && box?.el === el ? box.r : null;
  const last = i === steps.length - 1;
  const end = useCallback(() => { saveTour(null); onEnd(); }, [onEnd]);
  const go = useCallback((n: number) => { saveTour({ id: f.id, from, i: n }); setI(n); }, [f.id, from]);
  const next = useCallback(() => (last ? end() : go(i + 1)), [last, end, go, i]);
  useEffect(() => saveTour({ id: f.id, from, i }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // keep looking for this step's control: it may appear later (a page change, a panel the user opens, data loading)
  useEffect(() => {
    const at = targets(steps[i]);
    if (!at.length) return;
    let n = 0, ticks = 0, cur: HTMLElement | null = null;
    const look = () => {
      // kept while on screen; in the step's first seconds one that left it (a list that jumped to its newest row once loaded,
      // or picked under a loading cover) is picked again (pick prefers one on screen) and scrolled to; later, the user scrolled
      if (cur?.isConnected && shown(cur) && (++ticks > SETTLE || onScreen(cur))) return;
      const hit = at.flatMap(localized).map(findControl).find(Boolean) ?? null;
      if (hit) {
        cur = hit;
        hit.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setFound({ i, el: hit });
      } else if (++n === 12) setWaited(i);
    };
    look();
    const t = setInterval(look, 250);
    return () => clearInterval(t);
  }, [steps, i]);

  // a hover-only control (opacity 0 until hover) shows while it is lit
  useEffect(() => {
    const hidden: [HTMLElement, string][] = [];
    for (let n: HTMLElement | null = el, k = 0; n && k < 5; n = n.parentElement, k++) {
      if (getComputedStyle(n).opacity === "0") { hidden.push([n, n.style.opacity]); n.style.opacity = "1"; }
    }
    return () => hidden.forEach(([n, o]) => { n.style.opacity = o; });
  }, [el]);

  // follow it while the page scrolls or animates
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const tick = () => {
      const r = el.getBoundingClientRect();
      setBox((p) => (p?.el === el && p.r.x === r.x && p.r.y === r.y && p.r.width === r.width && p.r.height === r.height ? p : { el, r }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [el]);

  // using the lit control moves on: a click (saved first, a link may leave the page), a pick in a select; Esc leaves
  useEffect(() => {
    if (!el) return;
    const advance = () => { if (last) { end(); return; } saveTour({ id: f.id, from, i: i + 1 }); setTimeout(() => setI(i + 1), 350); };
    const onClick = (e: MouseEvent) => { if (!isField(el) && el.contains(e.target as Node)) advance(); };
    const onChange = (e: Event) => { if (el.matches("select") && e.target === el) advance(); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("change", onChange, true); };
  }, [el, last, end, f.id, from, i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [end]);

  const h = rect && { x1: rect.left - PAD, y1: rect.top - PAD, x2: rect.right + PAD, y2: rect.bottom + PAD };
  // dark everywhere but the hole; clip-path also limits where the shade catches clicks, so the hole stays clickable
  const clip = h
    ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${h.x1}px ${h.y1}px, ${h.x2}px ${h.y1}px, ${h.x2}px ${h.y2}px, ${h.x1}px ${h.y2}px, ${h.x1}px ${h.y1}px)`
    : "polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 50% 50%, 50% 50%, 50% 50%, 50% 50%, 50% 50%)";
  const W = 340;
  const below = h && h.y2 + 230 < innerHeight;
  const pos: React.CSSProperties = h
    ? { left: Math.min(Math.max(12, h.x1), innerWidth - W - 12), ...(below ? { top: Math.max(12, h.y2 + 12) } : { bottom: Math.max(12, innerHeight - h.y1 + 12) }) }
    : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  const tip = el ? (isField(el) ? t("Nhập / chọn ở ô đang sáng rồi bấm Tiếp.") : t("Bấm vào chỗ đang sáng để làm bước này."))
    : !at.length ? t("Làm theo mô tả rồi bấm Tiếp.")
      : waited !== i ? t("Đang tìm trên trang…")
        : role ? t("Chưa thấy chỗ này. Tính năng dành cho vai trò {role}: đổi ở Cài đặt › Chung › Vai trò nếu bạn đang ở vai trò khác.", { role })
          : t("Chưa thấy chỗ này trên màn hình: có thể cần dữ liệu phù hợp, hoặc làm bước trước. Bấm Tiếp để bỏ qua.");

  // portal: the top bar is a stacking context (sticky z-30) that app dialogs would cover
  return createPortal(
    <div data-guide-tour className="pointer-events-none fixed inset-0 z-[70]">
      <div className="pointer-events-auto absolute inset-0 bg-black/75 transition-[clip-path] duration-300 ease-(--ease-out) animate-in fade-in-0" style={{ clipPath: clip }} />
      {h && (
        <div aria-hidden className="absolute rounded-lg ring-2 ring-hl transition-[left,top,width,height] duration-300 ease-(--ease-out)"
          style={{ left: h.x1, top: h.y1, width: h.x2 - h.x1, height: h.y2 - h.y1 }}>
          <span className="absolute inset-0 animate-ping rounded-lg ring-2 ring-hl/60" />
        </div>
      )}
      <div role="dialog" aria-label={t("Hướng dẫn: {title}", { title: f.title })} style={{ ...pos, width: W, maxWidth: "calc(100vw - 24px)" }}
        className="pointer-events-auto absolute grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-cotton p-4 text-sm text-ink shadow-pop transition-[left,top,bottom] duration-300 ease-(--ease-out)">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-hl-wash px-2 py-0.5 text-2xs font-bold text-hl-2 tabular-nums">{t("Bước {i}/{n}", { i: i + 1, n: steps.length })}</span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-3">{f.title}</span>
          <Button size="icon-xs" variant="ghost" aria-label={t("Thoát hướng dẫn (Esc)")} onClick={end}><X /></Button>
        </div>
        <p key={i} className="leading-relaxed animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)"><StepText text={stepText(steps[i])} /></p>
        <p className="text-xs text-ink-3">{tip}</p>
        <div className="flex items-center gap-1.5">
          <div className="flex flex-1 gap-1" aria-hidden>
            {steps.map((_, n) => <span key={n} className={cn("h-1.5 rounded-full transition-[width,background-color] duration-(--dur-short)", n === i ? "w-4 bg-hl" : n < i ? "w-1.5 bg-hl/50" : "w-1.5 bg-rule-2")} />)}
          </div>
          {i > 0 && <Button size="sm" variant="ghost" onClick={() => go(i - 1)}>{t("Bước trước")}</Button>}
          <Button size="sm" onClick={next}>{last ? t("Xong") : t("Tiếp")}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
