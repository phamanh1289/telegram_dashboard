"use client";

// Per-browser preferences in localStorage. `theme` is shared with the YouTrack module (missing = follow the OS).

/** One stored preference; null when missing or storage is blocked. */
export function getPref(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** Save one preference (null removes it) and tell open views (wait labels re-render with a new threshold). */
export function setPref(key: string, value: string | null) {
  put(key, value);
  dispatchEvent(new Event("prefs"));
}

/** A stored JSON list of strings, else `fallback`. */
function readList(key: string, fallback: string[]) {
  try {
    const v = JSON.parse(getPref(key) ?? "null");
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : fallback;
  } catch {
    return fallback;
  }
}

export type ThemePref = "light" | "dark" | "system";

export function readTheme(): ThemePref {
  const t = getPref("theme");
  return t === "light" || t === "dark" ? t : "system";
}

/** Save and apply the theme; the swap crossfades through a view transition where supported. */
export function applyTheme(pref: ThemePref, save = true) {
  if (save) put("theme", pref === "system" ? null : pref);
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  const swap = () => {
    root.classList.toggle("dark", dark);
    root.dataset.theme = dark ? "dark" : "light";
  };
  if (root.classList.contains("dark") === dark || !document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return swap();
  const vt = document.startViewTransition(swap);
  vt.ready.catch(() => {}); // skipped when another transition starts; the swap still runs
}

/** Each member's look (Cài đặt chung), saved per browser; public/design/look.js applies it before first paint and in every open tab. */
export type UiStyle = "simple" | "default" | "vivid";
export type Look = { style: UiStyle; hue: number; hue2: number; gradient: boolean };
/** Preset highlight hues; the slider reaches the rest. */
export const ACCENTS = [[40, "Đất nung"], [355, "Hồng"], [305, "Tím"], [255, "Xanh dương"], [195, "Xanh ngọc"], [145, "Xanh lá"]] as const;
const hue = (v: unknown, d: number) => { const n = parseFloat(String(v)); return n >= 0 && n < 360 ? n : d; };
export function readLook(): Look {
  const s = getPref("uiStyle");
  return { style: s === "simple" || s === "vivid" ? s : "default", hue: hue(getPref("accent"), 40), hue2: hue(getPref("accent2"), 355), gradient: getPref("gradient") === "1" };
}
export function saveLook(l: Look) {
  put("uiStyle", l.style === "default" ? null : l.style);
  put("accent", String(l.hue));
  put("accent2", String(l.hue2));
  put("gradient", l.gradient ? "1" : "0");
  window.applyLook?.();
}
declare global { interface Window { applyLook?: () => void } }

/** Hours a tag may wait before it turns overdue (amber). */
export const OVERDUE_CHOICES = [1, 2, 4, 8, 24] as const;
export function readOverdueHours() {
  const n = Number(getPref("overdueHours"));
  return n > 0 ? n : 4;
}

/** Row actions (ghim, ngữ cảnh, mở Telegram): tucked behind Xong until it is hovered, or always shown. */
export type RowActionsPref = "hover" | "always";
export function readRowActions(): RowActionsPref {
  return getPref("rowActions") === "always" ? "always" : "hover";
}
export function applyRowActions(pref: RowActionsPref) {
  put("rowActions", pref);
  if (pref === "always") document.documentElement.dataset.rowActions = "always";
  else delete document.documentElement.dataset.rowActions;
}

/** The composer opens its AI block by default (the composer also flips this when toggled). */
export const readComposerAiOpen = () => getPref("composerAiOpen") === "1";

/** Desktop notification for new tags while the tab is in the background. */
export function readNotify() {
  try {
    return getPref("notify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/** Quick replies inserted from the composer. */
export const readTemplates = () => readList("replyTemplates", []);
export const saveTemplates = (list: string[]) => put("replyTemplates", JSON.stringify(list));

/** Project the AI Agent dialog last ran in ("" = none chosen yet). */
export const readAgentProject = () => getPref("agentProject") ?? "";

/** Angle the assistant analyses tags from; sent with every /ai/draft. */
export const PLATFORMS = [["android", "Android"], ["ios", "iOS"], ["mobile", "Mobile chung"], ["any", "Không giới hạn"]] as const;
export type Platform = (typeof PLATFORMS)[number][0];
export function readPlatform(): Platform {
  const v = getPref("aiPlatform");
  return PLATFORMS.find(([p]) => p === v)?.[0] ?? "android";
}

/** Teams Digest checks for impact; sent with every /digest. */
export const DEFAULT_DIGEST_TEAMS = ["Web", "Mobile", "Backend", "QA", "Design"];
export const readDigestTeams = () => readList("digestTeams", DEFAULT_DIGEST_TEAMS);
export const saveDigestTeams = (list: string[]) => put("digestTeams", JSON.stringify(list));
