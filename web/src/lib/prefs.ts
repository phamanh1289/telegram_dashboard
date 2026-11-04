"use client";

import { useSyncExternalStore } from "react";

// Per-browser preferences in localStorage. `theme` is shared with the YouTrack module (missing = follow the OS).

/** One stored preference; null when missing or storage is blocked. */
export function getPref(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Save without telling open views: for state that only needs to survive a reload (no re-render of every clock). */
export function put(key: string, value: string | null) {
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

/** Quick replies inserted from the composer; until edited in Settings, the role's starter set. */
export const readTemplates = () => readList("replyTemplates", ROLE_TEMPLATES[readYtRole() ?? "dev"]);
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

/** The role (Cài đặt chung › Hệ thống): YouTrack's home, views, dashboard and AI, and Telegram's AI angle and AI Agent follow it. null = not chosen yet. */
export type YtRole = "dev" | "qa" | "po";
export const YT_ROLES: [YtRole, string, string][] = [
  ["dev", "Dev", "Việc của tôi hôm nay, standup, việc đã hứa, ticket bị QC trả lại. Giao AI Agent đọc / sửa code trong thư mục dự án."],
  ["qa", "QA/QC", "Hàng đợi test, bug triage, test case, regression; tỷ lệ pass / trả lại / reopen. AI tóm tắt theo bước tái hiện, môi trường; không cần thư mục code."],
  ["po", "PO/PM", "Brief sprint, backlog và grooming, việc chờ PO chốt; tiến độ, dự báo, tải việc của team. AI tóm tắt theo ảnh hưởng, ưu tiên; không cần thư mục code."],
];
const ROLE_TEMPLATES: Record<YtRole, string[]> = {
  dev: [],
  qa: [
    "Mình đã tái hiện được, đang log bug.",
    "Bạn cho mình xin thêm build, thiết bị / OS và các bước tái hiện nhé.",
    "Đã test lại trên build mới: OK, mình close ticket.",
    "Test lại vẫn lỗi, mình reopen ticket và gửi thêm log.",
  ],
  po: [
    "Mình ghi nhận, sẽ chốt ưu tiên và phản hồi trong hôm nay.",
    "Phần này ngoài scope sprint hiện tại, mình đưa vào backlog để groom.",
    "Chốt: làm theo phương án này. Team cập nhật ticket giúp mình.",
    "Mình cần thêm thông tin về ảnh hưởng tới người dùng để quyết định.",
  ],
};
export function readYtRole(): YtRole | null {
  const m = getPref("ytMode");
  return m === "dev" || m === "qa" ? m : m === "po" || m === "lead" ? "po" : null; // "lead" = the old PO / PM mode
}
/** Save or clear (null) the role; open YouTrack pages follow at once (the "prefs" event). */
export const saveYtRole = (r: YtRole | null) => setPref("ytMode", r);
/** Re-render on a saved preference, here or in another tab. */
export const onPrefs = (f: () => void) => { addEventListener("prefs", f); addEventListener("storage", f); return () => { removeEventListener("prefs", f); removeEventListener("storage", f); }; };
/** The role, live; null = not chosen (Telegram then acts as Dev). */
export const useRole = () => useSyncExternalStore(onPrefs, readYtRole, () => null);
/** QA and PO never work in a code folder: no AI Agent, no project picker. */
export const usesCode = (r: YtRole | null) => r !== "qa" && r !== "po";

/** When the YouTrack report writes itself: weekdays (0 = Monday) and a time, per browser; off = never automatic. */
export type ReportAt = { on: boolean; days: number[]; time: string };
export function readReportAt(): ReportAt {
  try { const v = JSON.parse(getPref("ytReportAt") ?? "null"); if (v && Array.isArray(v.days) && /^\d\d:\d\d$/.test(v.time)) return { on: !!v.on, days: v.days, time: v.time }; } catch {}
  return { on: false, days: [0, 1, 2, 3, 4], time: "09:00" };
}
export const saveReportAt = (v: ReportAt) => setPref("ytReportAt", JSON.stringify(v));
