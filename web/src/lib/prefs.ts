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

/** Save without telling open views: for state that only needs to survive a reload (no re-render of every clock).
 *  False when storage is blocked or full (callers that would lose user text check it). */
export function put(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Save one preference (null removes it) and tell open views (wait labels re-render with a new threshold). */
export function setPref(key: string, value: string | null) {
  put(key, value);
  dispatchEvent(new Event("prefs"));
}

/** A stored JSON value, else `fallback` (missing, unreadable or not JSON). */
export function readJson(key: string, fallback: unknown = null): unknown {
  try {
    return JSON.parse(getPref(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
/** A stored JSON list, keeping the entries `ok` accepts; else `fallback`. */
export function readList<T>(key: string, fallback: T[], ok: (x: unknown) => x is T): T[] {
  const v = readJson(key);
  return Array.isArray(v) ? v.filter(ok) : fallback;
}
export const isString = (x: unknown): x is string => typeof x === "string";

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

/** Each member's look (Cài đặt chung), saved per browser; the boot script in app/layout.tsx (window.applyLook) applies it before first paint and in every open tab. */
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

/** Minutes a Q&A question of yours may go unanswered before the Q&A page asks you to nudge the group (0: never). */
export const QA_REMIND_CHOICES = [0, 15, 30, 60, 120, 240] as const;
export function readQaRemind(): number {
  const v = getPref("qaRemindMins");
  return v !== null && (QA_REMIND_CHOICES as readonly number[]).includes(Number(v)) ? Number(v) : 30;
}
export const qaRemindLabel = (m: number) => (m === 0 ? "Tắt" : m < 60 ? `${m} phút` : `${m / 60} giờ`);
/** The Q&A nudge threshold, live (Settings and the Q&A page both change it). */
export const useQaRemind = () => useSyncExternalStore(onPrefs, readQaRemind, () => 30);
/** When a Q&A question counts as answered: a reply from anyone but the asker, or only from someone it tagged. */
export type QaAnswerBy = "any" | "tagged";
/** Default "tagged": only a reply from someone the question tagged counts as answered (Cài đặt can widen it to anyone). */
export const readQaAnswerBy = (): QaAnswerBy => (getPref("qaAnswerBy") === "any" ? "any" : "tagged");

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

/** Desktop notification for new tags while the tab is in the background. */
export function readNotify() {
  try {
    return getPref("notify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/** Project the AI Agent dialog last ran in ("" = none chosen yet). */
export const readAgentProject = () => getPref("agentProject") ?? "";

/** Angle the assistant analyses tags from; sent with every /ai/draft. */
export const PLATFORMS = [["android", "Android"], ["ios", "iOS"], ["mobile", "Mobile chung"], ["any", "Không giới hạn"]] as const;
export type Platform = (typeof PLATFORMS)[number][0];
export function readPlatform(): Platform {
  const v = getPref("aiPlatform");
  return PLATFORMS.find(([p]) => p === v)?.[0] ?? "android";
}

/** The user's self-introduction (role, platform, expertise) for every AI feature; "" = not written yet. */
export const INTRO_MAX = 2000;
export const readIntro = () => (getPref("aiIntro") ?? "").trim().slice(0, INTRO_MAX);
/** Live, so an open dialog drops its "AI chưa biết bạn làm gì" notice once Settings saves one. */
export const useIntro = () => useSyncExternalStore(onPrefs, readIntro, () => "");

/** Teams Digest checks for impact; sent with every /digest. */
export const DEFAULT_DIGEST_TEAMS = ["Web", "Mobile", "Backend", "QA", "Design"];
export const readDigestTeams = () => readList("digestTeams", DEFAULT_DIGEST_TEAMS, isString);

/** The role (Cài đặt chung › Hệ thống): YouTrack's home, views, dashboard and AI, and Telegram's AI angle and AI Agent follow it. null = not chosen yet. */
export type YtRole = "dev" | "qa" | "po";
export const YT_ROLES: [YtRole, string, string][] = [
  ["dev", "Dev", "Việc của tôi hôm nay, standup, việc đã hứa, ticket bị QC trả lại. Giao AI Agent đọc / sửa code trong thư mục dự án."],
  ["qa", "QA/QC", "Hàng đợi test, bug triage, test case, regression; tỷ lệ pass / trả lại / reopen. AI tóm tắt theo bước tái hiện, môi trường; không cần thư mục code."],
  ["po", "PO/PM", "Brief sprint, backlog và grooming, việc chờ PO chốt; tiến độ, dự báo, tải việc của team. AI tóm tắt theo ảnh hưởng, ưu tiên; không cần thư mục code."],
];
export function readYtRole(): YtRole | null {
  const m = getPref("ytMode");
  return m === "dev" || m === "qa" ? m : m === "po" || m === "lead" ? "po" : null; // "lead" = the old PO / PM mode
}
/** Who the user is, sent with every AI Agent session (Giao AI Agent, Đối chiếu BE): the BE frames them alike. */
export const aboutMe = () => ({ role: readYtRole(), platform: readPlatform(), intro: readIntro() });
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
