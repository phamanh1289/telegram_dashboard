// Dates and durations, in Vietnam time (Asia/Ho_Chi_Minh, UTC+7 all year), worded in the current UI language (lib/i18n).

import { type Key, readLang, t } from "@/lib/i18n";

const VN_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh", hourCycle: "h23", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const vnParts = (d: Date) => Object.fromEntries(VN_PARTS.formatToParts(d).map((p) => [p.type, p.value]));

/** Vietnam time, 24h: "16:12, hôm nay", "09:05, hôm qua" (snoozes: "ngày mai"), else "16:12, 28/10/2026" (also `full`). */
export function timeLabel(date: string, full = false) {
  const p = vnParts(new Date(date));
  const time = `${p.hour}:${p.minute}`;
  return full ? `${time}, ${p.day}/${p.month}/${p.year}` : `${time}, ${dayLabel(date).toLocaleLowerCase(readLang())}`;
}

const dayNo = (x: Record<string, string>) => Date.UTC(+x.year, +x.month - 1, +x.day) / 86_400_000;

/** Vietnam calendar day: "Hôm nay", "Hôm qua", "Ngày mai", else "28/10/2026". Also the key for day separators. */
export function dayLabel(date: string) {
  const p = vnParts(new Date(date));
  const k = ({ [-1]: "Hôm qua", 0: "Hôm nay", 1: "Ngày mai" } as const)[dayNo(p) - dayNo(vnParts(new Date()))];
  return k ? t(k) : `${p.day}/${p.month}/${p.year}`;
}

/** Vietnam wall-clock h:m, `days` after today in Vietnam, as an instant (Vietnam is UTC+7 all year). */
export function vnAt(days: number, h: number, m = 0, now = Date.now()) {
  const p = vnParts(new Date(now));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + days, h - 7, m));
}
/** A datetime-local value ("2026-11-05T14:30") read as Vietnam time, and back. */
export const fromVnInput = (v: string) => {
  const [y, mo, d, h, mi] = v.split(/[-T:]/).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 7, mi));
};
export const vnInput = (t: Date) => {
  const p = vnParts(t);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

/** A snooze preset: its label (an i18n key, stable across languages: render it with `t`), when, and whether the menu
 *  adds the clock time (relative ones: "1 giờ" → "16:12"). */
export type SnoozeChoice = { label: Key; at: Date; clock: boolean };
/** Snooze presets, in Vietnam time like their labels; "14:00 hôm nay" only before 14:00. */
export function snoozeChoices(now = Date.now()): SnoozeChoice[] {
  const p = vnParts(new Date(now));
  const weekday = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay(); // 0 = Sunday
  const two = vnAt(0, 14, 0, now);
  return [
    { label: "1 giờ", at: new Date(now + 3600_000), clock: true },
    { label: "3 giờ", at: new Date(now + 3 * 3600_000), clock: true },
    ...(two.getTime() > now ? [{ label: "14:00 hôm nay" as const, at: two, clock: false }] : []),
    { label: "Sáng mai 9:00", at: vnAt(1, 9, 0, now), clock: false },
    { label: "Thứ Hai 9:00", at: vnAt((8 - weekday) % 7 || 7, 9, 0, now), clock: false },
  ];
}

/** "16:12" in Vietnam time, for rows under a day separator. */
export const clockLabel = (date: string) => {
  const p = vnParts(new Date(date));
  return `${p.hour}:${p.minute}`;
};

/** Local calendar day "YYYY-MM-DD" (Swedish locale = ISO order). */
export const ymd = (t: number | Date = Date.now()) => new Date(t).toLocaleDateString("sv");
/** Short day "2/11" from a time or a "YYYY-MM-DD" day. */
export const dm = (d: number | string) => {
  const [, m, day] = (typeof d === "string" ? d : ymd(d)).split("-");
  return `${+day}/${+m}`;
};

/** Minutes in the largest whole unit: [12, "phút"], [3, "giờ"], [2, "ngày"]. */
export const byUnit = (mins: number): [number, string] => {
  const [n, u] = mins < 60 ? [mins, "phút"] as const : mins < 1440 ? [Math.floor(mins / 60), "giờ"] as const : [Math.floor(mins / 1440), "ngày"] as const;
  return [n, t(u, { n })];
};
/** "12 phút", "3 giờ", "2 ngày" (en: "12 min", "3 h", "2 days"). */
export const span = (mins: number) => byUnit(mins).join(" ");

/** "vừa xong", "5 phút trước", "3 giờ trước", "2 ngày trước" (`at`: ms or ISO). */
export function ago(at: number | string, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60_000));
  return mins < 1 ? t("vừa xong") : t("{span} trước", { span: span(mins) });
}
