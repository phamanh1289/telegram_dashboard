"use client";

// Per-browser preferences in localStorage. `theme` is shared with the YouTrack module (missing = follow the OS).

export type ThemePref = "light" | "dark" | "system";

export function readTheme(): ThemePref {
  try {
    const t = localStorage.theme;
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** Save and apply the theme; the swap crossfades through a view transition where supported. */
export function applyTheme(pref: ThemePref, save = true) {
  if (save) {
    try {
      if (pref === "system") localStorage.removeItem("theme");
      else localStorage.theme = pref;
    } catch {}
  }
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

/** Hours a tag may wait before it turns overdue (amber). */
export const OVERDUE_CHOICES = [1, 2, 4, 8, 24] as const;
export function readOverdueHours() {
  try {
    const n = Number(localStorage.overdueHours);
    return n > 0 ? n : 4;
  } catch {
    return 4;
  }
}

/** The composer opens its AI block by default (the composer also flips this when toggled). */
export function readComposerAiOpen() {
  try {
    return localStorage.composerAiOpen === "1";
  } catch {
    return false;
  }
}

/** Desktop notification for new tags while the tab is in the background. */
export function readNotify() {
  try {
    return localStorage.notify === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/** Quick replies inserted from the composer. */
export function readTemplates(): string[] {
  try {
    const v = JSON.parse(localStorage.replyTemplates ?? "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}
export function saveTemplates(list: string[]) {
  try { localStorage.replyTemplates = JSON.stringify(list); } catch {}
}

/** Project the AI Agent dialog last ran in ("" = none chosen yet). */
export function readAgentProject(): string {
  try {
    return localStorage.agentProject ?? "";
  } catch {
    return "";
  }
}

/** Angle the assistant analyses tags from; sent with every /ai/draft. */
export const PLATFORMS = [["android", "Android"], ["ios", "iOS"], ["mobile", "Mobile chung"], ["any", "Không giới hạn"]] as const;
export type Platform = (typeof PLATFORMS)[number][0];
export function readPlatform(): Platform {
  try {
    const v = localStorage.aiPlatform;
    return PLATFORMS.some(([p]) => p === v) ? v : "android";
  } catch {
    return "android";
  }
}

/** Teams Digest checks for impact; sent with every /digest. */
export const DEFAULT_DIGEST_TEAMS = ["Web", "Mobile", "Backend", "QA", "Design"];
export function readDigestTeams(): string[] {
  try {
    const v = JSON.parse(localStorage.digestTeams ?? "null");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : DEFAULT_DIGEST_TEAMS;
  } catch {
    return DEFAULT_DIGEST_TEAMS;
  }
}
export function saveDigestTeams(list: string[]) {
  try { localStorage.digestTeams = JSON.stringify(list); } catch {}
}
