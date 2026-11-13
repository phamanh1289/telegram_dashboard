import { getPref, setPref } from "@/lib/prefs";

/** This browser only: groups you posted Q&A to, newest first (they lead the Q&A sidebar and are watched for answers). */
export const QA_RECENT = "qa-recent-groups";
export const parsePref = <T,>(raw: string | null, fallback: T): T => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
/** Follow a group's Q&A: you just posted a #QA question / answer there (Q&A page, a sent ask). */
export const rememberQaGroup = (id: string) =>
  setPref(QA_RECENT, JSON.stringify([id, ...parsePref<string[]>(getPref(QA_RECENT), []).filter((x) => x !== id)].slice(0, 20)));
