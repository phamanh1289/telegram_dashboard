"use client";

import { Fragment, createElement, type ReactNode, useSyncExternalStore } from "react";
import { getPref, onPrefs, setPref } from "@/lib/prefs";
import { EN } from "./en";

// UI language. Source strings are Vietnamese and double as keys: `t("Hôm nay")` shows the key itself in Vietnamese and
// EN["Hôm nay"] in English. A key missing from EN fails typecheck (`Key`), so every new UI string needs both languages.
// Placeholders: `t("Còn {n} tin", { n })`; an EN value may be a function for plurals (`(v) => v.n === 1 ? … : …`).
// One Vietnamese word, two meanings in English: add a context after "|" ("Cập nhật|lúc" → "Updated"); vi drops it.

export type Lang = "vi" | "en";
export type Vars = Record<string, string | number>;
export type Key = keyof typeof EN;
export type EnValue = string | ((v: Vars) => string);
/** One area's English strings, keyed by the Vietnamese source. */
export type Dict = Record<string, EnValue>;

/** The machine's language: Vietnamese when its first preferred language is Vietnamese, else English. */
const machineLang = (): Lang => {
  try {
    return /^vi\b/i.test(navigator.languages?.[0] ?? navigator.language) ? "vi" : "en";
  } catch {
    return "vi";
  }
};

/** The chosen language (Cài đặt › Chung), else the machine's. The boot script in app/layout.tsx reads it the same way. */
export function readLang(): Lang {
  const v = getPref("lang");
  return v === "vi" || v === "en" ? v : machineLang();
}
/** Save the language (null = follow the machine); every open view re-renders at once. */
export function saveLang(l: Lang | null) {
  setPref("lang", l);
  document.documentElement.lang = readLang();
}
/** The language, live. The static HTML is prerendered in Vietnamese, so hydration starts there and switches right after. */
export const useLang = () => useSyncExternalStore(onPrefs, readLang, () => "vi" as Lang);

const vi = (key: string) => key.replace(/\|[^|{}]*$/, "");
const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

/** `key` in `lang`, placeholders filled. */
export function tr(lang: Lang, key: Key, v?: Vars): string {
  if (lang === "vi") return fill(vi(key), v);
  const e = EN[key] as EnValue;
  return typeof e === "function" ? e(v ?? {}) : fill(e, v);
}

/** Outside render (event handlers, toasts, module code): the language at call time. In components use `useT()`. */
export const t = (key: Key, v?: Vars) => tr(readLang(), key, v);

/** Text from the server (the YouTrack router answers errors as plain Vietnamese text): translated when it is a known key. */
export const tMaybe = (s: string) => (s in EN ? t(s as Key) : s);

/** Like `t`, but a placeholder may be a React node (a <Kbd>, a link): returns a fragment. */
export function tn(lang: Lang, key: Key, v: Record<string, ReactNode>): ReactNode {
  const s = lang === "vi" ? vi(key) : (EN[key] as EnValue);
  const text = typeof s === "function" ? s({}) : s;
  return createElement(Fragment, null, ...text.split(/(\{\w+\})/).map((p, i) => {
    const k = /^\{(\w+)\}$/.exec(p)?.[1];
    return k && k in v ? createElement(Fragment, { key: i }, v[k]) : p;
  }));
}

const bind = (lang: Lang) => Object.assign((key: Key, v?: Vars) => tr(lang, key, v), {
  lang,
  n: (key: Key, v: Record<string, ReactNode>) => tn(lang, key, v),
});
/** One bound `t` per language: stable identity, safe in effect / memo deps. */
const BOUND = { vi: bind("vi"), en: bind("en") };

/** `t` bound to the live language: components re-render when it changes. `t.lang` for branching, `t.n` for node placeholders. */
export const useT = () => BOUND[useLang()];
export type T = ReturnType<typeof useT>;

/** BCP 47 locale for dates and numbers: en-GB keeps day/month order and a 24h clock, like the Vietnamese UI. */
export const locale = (lang: Lang = readLang()) => (lang === "vi" ? "vi-VN" : "en-GB");
/** Number in the current language: 80.000 / 80,000. */
export const fmtNum = (n: number, lang?: Lang) => n.toLocaleString(locale(lang));
/** File size in the current language, decimal units like Finder: 1,2 MB / 812 kB. */
export const fmtBytes = (b: number, lang?: Lang) => {
  const [v, unit] = b >= 1e9 ? [b / 1e9, "gigabyte"] : b >= 1e6 ? [b / 1e6, "megabyte"] : [b / 1e3, "kilobyte"];
  return v.toLocaleString(locale(lang), { style: "unit", unit, maximumFractionDigits: v < 10 ? 1 : 0 });
};
/** Date / time in Vietnam time, formatted for the current language (`opts` as Intl.DateTimeFormat). */
export const fmtDate = (t: number | string | Date, opts: Intl.DateTimeFormatOptions = {}, lang?: Lang) =>
  new Date(t).toLocaleString(locale(lang), { timeZone: "Asia/Ho_Chi_Minh", ...opts });
/** Day only: 28/10/2026. */
export const fmtDay = (t: number | string | Date, lang?: Lang) => fmtDate(t, { day: "2-digit", month: "2-digit", year: "numeric" }, lang);
/** Clock only, 24h: 16:12. */
export const fmtClock = (t: number | string | Date, lang?: Lang) => fmtDate(t, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, lang);
