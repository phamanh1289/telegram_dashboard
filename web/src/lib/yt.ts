"use client";

// YouTrack module: server API (/api/yt/*), ticket domain rules, and the pure filtering / sorting / grouping of the ticket table.
// Ported from public/yt/js (ticket.js, query.js, api.js); the dashboard numbers live in yt-stats.ts.

export type Ticket = {
  id: string;
  summary: string | null;
  created: number;
  updated: number;
  resolved: number | null;
  type: string | null;
  state: string | null;
  priority: string | null;
  assignee: string | null;
  assigneeLogin: string | null;
  qc: string | null;
  due: number | null;
  estimate: number | null;
  sprints: string[];
};
export type Comment = { text: string | null; created: number; author: string | null };
export type Link = { rel: string; issues: { id: string; summary: string | null; resolved: number | null }[] };
export type Detail = Ticket & { description: string; reporter: string | null; comments: Comment[]; links: Link[] };
export type Config = { base: string; mock: boolean; t: { wip: number; stale: number; dead: number }; hist: number; ai: boolean };
export type Sprint = { name: string; start: number; finish: number };
export type Person = { login: string; name: string };
export type Mention = { chat_id: string; chat: string; from: string | null; text: string; date: number };
export type AiText = { text: string; draft?: string };

/** /api/yt/* call; the YouTrack router answers errors as {error: "text"}, the shared API as {error: {code, detail}}. */
export async function ytApi<T>(path: string, init: { json?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`/api/yt${path}`, {
    method: init.json === undefined ? "GET" : "POST",
    cache: "no-store",
    signal: init.signal,
    headers: init.json === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new Error(typeof e === "string" ? e : e?.detail || e?.code || `HTTP ${res.status}`);
  }
  return body as T;
}
const enc = encodeURIComponent;
export const yt = {
  config: () => ytApi<Config>("/config"),
  projects: () => ytApi<{ shortName: string; name: string }[]>("/projects"),
  me: () => ytApi<{ login: string | null; name: string | null }>("/me").catch(() => ({ login: null, name: null })),
  people: (p: string) => ytApi<Person[]>(`/people?project=${enc(p)}`),
  sprints: (p: string) => ytApi<Sprint[]>(`/sprints?project=${enc(p)}`),
  // who = 'me' | 'unassigned' | login; null = everyone
  issues: (p: string, who: string[] | null, signal?: AbortSignal) =>
    ytApi<Ticket[]>(`/issues?project=${enc(p)}&scope=all${who ? `&who=${enc(who.join(","))}` : ""}`, { signal }),
  detail: (id: string) => ytApi<Detail>(`/issue?id=${enc(id)}`),
  since: (items: string[]) => ytApi<Record<string, number>>(`/statesince?items=${enc(items.join(","))}`),
  setAssignee: (id: string, login: string | null) => ytApi<Ticket>("/issue/assignee", { json: { id, login } }),
  comment: (id: string, text: string) => ytApi<{ ok: true }>("/issue/comment", { json: { id, text } }),
  mentions: (id: string) => ytApi<Mention[]>(`/mentions?id=${enc(id)}`),
  aiTicket: (id: string, kind: "brief" | "ready" | "stuck" | "reply", signal?: AbortSignal) => ytApi<AiText>("/ai/ticket", { json: { id, kind }, signal }),
  aiData: (kind: "report" | "notes" | "ask", data: unknown, signal?: AbortSignal, question = "") => ytApi<AiText>("/ai/data", { json: { kind, data, question }, signal }),
  aiTickets: (ids: string[], scope: string, kind: "review" | "today", signal?: AbortSignal) => ytApi<AiText>("/ai/tickets", { json: { ids, scope, kind }, signal }),
  aiFilter: (text: string, options: unknown) => ytApi<Record<string, unknown>>("/ai/filter", { json: { text, options } }),
};
export const AI_MAX = 40; // the server's cap on tickets in one review

// ---------- formatting ----------
export const DAY = 864e5;
export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
export const fmt = (n: number) => n.toLocaleString("vi-VN");
export const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—");
export const ago = (t: number) => { const m = (Date.now() - t) / 6e4; return m < 1 ? "vừa xong" : m < 60 ? `${Math.floor(m)} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ` : `${Math.floor(m / 1440)} ngày`; };
export const dm = (t: number) => { const x = new Date(t); return `${x.getDate()}/${x.getMonth() + 1}`; };
export const hue = (s: string) => 200 + [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7) % 100; // blue→violet only, never reads as ok / warn / bad
export const shortName = (n: string) => n.trim().split(/\s+/).slice(-2).join(" ");
export const initials = (n: string) => { const w = n.trim().split(/\s+/); return ((w.length > 1 ? w[w.length - 2][0] : "") + w[w.length - 1][0]).toUpperCase(); };
export const shortSp = (s: string) => s.replace(/^Tuần\s*(\d+)\s*-\s*T(\d+)$/i, "T$1-T$2");
export const issueUrl = (base: string, id: string) => `${base}/issue/${id}`;

/** Tiny YouTrack-markdown: images dropped, links, **bold**, `code`; returns safe HTML. */
const IMG = /!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const md = (s: string | null | undefined) => esc(s || "").replace(IMG, "[ảnh]")
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a target="_blank" rel="noopener" href="$2">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
export const snippet = (s: string | null | undefined) => { const t = (s || "").replace(IMG, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`#>_]/g, "").replace(/\s+/g, " ").trim(); return t.length > 320 ? t.slice(0, 320) + "…" : t; };

// ---------- ticket domain ----------
const up = (s: string | null | undefined) => String(s || "").toUpperCase();

/** Every [...] in the title becomes a chip (a one-letter prefix such as "C-" is dropped). */
const TAGRE = /\[([^\]]+)\]/g;
const titles = new WeakMap<Ticket, string[]>();
export const tagsOf = (i: Ticket) => {
  let t = titles.get(i);
  if (!t) titles.set(i, (t = [...(i.summary || "").matchAll(TAGRE)].map((x) => x[1].trim().replace(/^[A-Za-z]-(?=\S)/, "")).filter(Boolean)));
  return t;
};

// state -> tier colour: slate todo, blue working, violet with QC, teal built on dev / waiting release, pink design, green done, red blocked
const SC: Record<string, string> = {
  "OPENED": "todo", "TO DO": "todo", "TODO": "todo", "DEVELOPMENT APPROVED": "todo", "IN PROGRESS": "doing", "DESIGN IN PROCESS": "design",
  "READY FOR TEST": "qc", "QC - QA": "qc", "QC": "qc", "BUILT ON DEV": "dev", "DONE ON DEV": "dev", "WAITING TO RELEASE": "dev", "BLOCKED": "block",
  "ON HOLD": "block", "ASSIGN TO DESIGN": "design", "CONFIRM DESIGN": "design", "ASSIGN TO DEFINE": "design", "DEFINITION IN PROCESS": "design",
  "CONFIRM DEFINITION": "design", "DONE": "done", "DONE ON PROD": "done", "CLOSED": "done",
};
export const stateColor = (s: string | null | undefined) => `var(--st-${SC[up(s)] || "todo"})`;
export const stateSem = (s: string | null | undefined) => ({ DONE: "ok", "DONE ON PROD": "ok", CLOSED: "ok", BLOCKED: "bad", "ON HOLD": "bad" })[up(s)] ?? "";

const TC: Record<string, string> = { EPIC: "epic", STORY: "feat", "USER STORY": "feat", FEATURE: "feat", IMPROVEMENT: "impr", ENHANCEMENT: "impr", TASK: "task", "SUB-TASK": "sub", SUBTASK: "sub", "SUB TASK": "sub" };
export const typeColor = (t: string | null | undefined) => (up(t) === "BUG" ? "var(--color-error)" : TC[up(t)] ? `var(--ty-${TC[up(t)]})` : "var(--color-ink-3)");

export const PCOL: Record<string, string> = { Critical: "var(--color-error)", Highest: "var(--color-signal-2)", High: "var(--color-warn)", Medium: "var(--color-ink-2)", Low: "var(--color-ink-3)", Lowest: "var(--color-ink-3)" };
const RANK: Record<string, number> = { Critical: 0, Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5 };
export const PLVL: Record<string, number> = { Critical: 4, Highest: 4, High: 3, Medium: 2, Low: 1, Lowest: 0 };
export const TINT = [16, 12, 8]; // row tint % for Critical / Highest / High while "Highlight High+" is on
export const rank = (i: { priority: string | null }) => RANK[i.priority ?? ""] ?? 6;

export type Now = number;
export const QUICK: Record<string, { label: string; fn: (i: Ticket, now: Now) => boolean }> = {
  blocked: { label: "Blocked", fn: (i) => up(i.state) === "BLOCKED" },
  critical: { label: "Critical / Highest", fn: (i) => rank(i) <= 1 },
  overdue: { label: "Quá hạn", fn: (i, now) => !!i.due && i.due < now },
  unassigned: { label: "Chưa assign", fn: (i) => !i.assignee },
  noest: { label: "Trong sprint, chưa estimate", fn: (i) => i.sprints.length > 0 && i.estimate == null },
};

// workflow buckets: 0 todo · 1 being worked on · 2 with QC / waiting for test · 3 done
const QC_ST = new Set(["READY FOR TEST", "QC - QA", "QC", "BUILT ON DEV", "DONE ON DEV", "WAITING TO RELEASE"]);
const DOING_ST = new Set(["IN PROGRESS", "DESIGN IN PROCESS", "CONFIRM DESIGN", "ASSIGN TO DESIGN", "BLOCKED"]);
export const bucket = (i: Ticket) => { const s = up(i.state); return i.resolved ? 3 : QC_ST.has(s) ? 2 : DOING_ST.has(s) ? 1 : 0; };
export const TIER_LABEL = ["Todo / Opened", "Đang làm", "QC / Chờ test"];
export const isBlocked = (i: Ticket) => up(i.state) === "BLOCKED";

export const COLS = [["id", "ID"], ["type", "Type"], ["summary", "Tiêu đề"], ["state", "State"], ["priority", "Priority"], ["assignee", "Assignee"], ["qc", "QC"], ["sprint", "Sprint"], ["due", "Hạn"], ["updated", "Cập nhật"]] as const;
export type ColKey = (typeof COLS)[number][0];
export const lastSp = (i: Ticket) => i.sprints[i.sprints.length - 1] || "";
const KEYS: Record<ColKey, (i: Ticket) => number | string> = {
  id: (i) => +i.id.replace(/\D+/g, "") || 0, summary: (i) => norm(i.summary), state: (i) => i.state || "", priority: rank, type: (i) => i.type || "",
  assignee: (i) => norm(i.assignee || "zzz"), qc: (i) => norm(i.qc || "zzz"), sprint: lastSp, updated: (i) => -i.updated, due: (i) => i.due || 9e15,
};
export const isColKey = (k: string): k is ColKey => k in KEYS;
export type Sort = { k: ColKey; d: "asc" | "desc" };
export const cmp = (s: Sort) => (a: Ticket, b: Ticket) => {
  const x = KEYS[s.k](a), y = KEYS[s.k](b);
  let r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "vi");
  if (s.d === "desc") r = -r;
  return r || b.updated - a.updated;
};
export const GROUPS = { assignee: (i: Ticket) => i.assignee || "Chưa assign", sprint: (i: Ticket) => lastSp(i) || "Không sprint", module: (i: Ticket) => tagsOf(i)[0] || "Không module" };
export type Group = keyof typeof GROUPS | "none";

// ---------- filters ----------
export const UNASSIGNED = "Unassigned";
export type Filters = {
  sprint: string[];
  assignee: string[]; // empty = everyone
  state: string[];
  priority: string[];
  type: string[];
  q: string;
  tier: 0 | 1 | 2 | null;
  group: Group;
  sort: Sort;
};
export const byAs = (f: Pick<Filters, "assignee">) => (i: Ticket) => !f.assignee.length || f.assignee.includes(i.assignee || UNASSIGNED);
export const bySp = (f: Pick<Filters, "sprint">) => (i: Ticket) => !f.sprint.length || i.sprints.some((s) => f.sprint.includes(s));

const hay = new WeakMap<Ticket, string>();
const hit = (i: Ticket, terms: string[]) => {
  let s = hay.get(i);
  if (s === undefined) hay.set(i, (s = norm(`${i.id} ${i.summary} ${i.assignee || ""} ${i.qc || ""} ${i.state || ""}`)));
  return terms.every((t) => s.includes(t));
};

/** Tickets matching every filter but the state chips; `skip` = the chip row being counted (its own choice does not narrow it). */
export function activePool(rows: Ticket[], f: Filters, o: { showRes: boolean; me: string | null }, skip?: "priority" | "type") {
  const terms = norm(f.q).split(/\s+/).filter(Boolean), as = byAs(f), sp = bySp(f);
  const myQc = (i: Ticket) => !!o.me && i.qc === o.me && f.assignee.includes(o.me); // "My task" also lists the tickets I test
  return rows.filter((i) => (o.showRes || !i.resolved) && sp(i) && (as(i) || myQc(i))
    && (skip === "priority" || !f.priority.length || f.priority.includes(i.priority || "—"))
    && (skip === "type" || !f.type.length || f.type.includes(i.type || "—"))
    && hit(i, terms) && (f.tier == null || bucket(i) === f.tier));
}

/** value -> count, chosen values kept at 0, ordered by `order`. */
export function counts(pool: Ticket[], key: "state" | "priority" | "type", chosen: string[]) {
  const c: Record<string, number> = {};
  for (const i of pool) c[i[key] || "—"] = (c[i[key] || "—"] || 0) + 1;
  for (const s of chosen) c[s] ||= 0;
  const by = key === "priority" ? (a: [string, number], b: [string, number]) => rank({ priority: a[0] }) - rank({ priority: b[0] }) || a[0].localeCompare(b[0]) : (a: [string, number], b: [string, number]) => b[1] - a[1];
  return Object.entries(c).sort(by);
}

export const visibleRows = (pool: Ticket[], f: Filters) => pool.filter((i) => !f.state.length || f.state.includes(i.state || "—")).sort(cmp(f.sort));

// newest sprint first: by start date when known, else by the "Tuần N - Tn" name, else by name
const spWeek = (n: string) => { const m = /Tuần\s*(\d+)\s*-\s*T(\d+)/i.exec(n); return m ? +m[2] * 100 + +m[1] : null; };
export const spNewer = (dates: Map<string, Sprint>) => (a: string, b: string) => {
  const da = dates.get(a)?.start, db = dates.get(b)?.start;
  if (da != null && db != null && da !== db) return db - da;
  const wa = spWeek(a), wb = spWeek(b);
  return wa != null && wb != null && wa !== wb ? wb - wa : b.localeCompare(a, "vi", { numeric: true });
};

export function groupRows(rows: Ticket[], g: Exclude<Group, "none">, dates: Map<string, Sprint>): [string, Ticket[]][] {
  const groups = new Map<string, Ticket[]>();
  for (const i of rows) { const k = GROUPS[g](i); (groups.get(k) ?? groups.set(k, []).get(k)!).push(i); }
  const newer = spNewer(dates);
  return [...groups].sort(g === "sprint" ? (a, b) => +(a[0] === "Không sprint") - +(b[0] === "Không sprint") || newer(a[0], b[0]) : (a, b) => b[1].length - a[1].length);
}

/** Global lookup: "123" -> "<project>-123", "va-12" -> "VA-12", else null. */
export const ticketId = (s: string, project: string) => { s = s.trim().toUpperCase(); return /^\d+$/.test(s) ? `${project}-${s}` : /^[A-Z][A-Z0-9_]*-\d+$/.test(s) ? s : null; };

// ---------- Dev "Hôm nay": my open tickets ranked by what should be done first, with the reasons ----------
export type Focus = { i: Ticket; score: number; why: string[] };
export function todayList(rows: Ticket[], me: string | null, since: (i: Ticket) => number | null, now: number): Focus[] {
  if (!me) return [];
  return rows.filter((i) => !i.resolved && (i.assignee === me || (i.qc === me && bucket(i) === 2))).map((i) => {
    const why: string[] = [];
    let score = 0;
    if (isBlocked(i)) { score += 50; why.push("Blocked"); }
    if (i.due && i.due < now) { score += 40; why.push("Quá hạn"); } else if (i.due && i.due - now < 2 * DAY) { score += 25; why.push("Sắp tới hạn"); }
    if (rank(i) <= 1) { score += 30; why.push(i.priority!); } else if (rank(i) === 2) score += 12;
    if (i.qc === me && i.assignee !== me) { score += 15; why.push("Chờ bạn test"); }
    if (bucket(i) === 1) { score += 10; why.push("Đang làm"); }
    const s = since(i);
    if (s != null && bucket(i) === 1 && now - s > 3 * DAY) { score += 15; why.push(`Đứng ${Math.floor((now - s) / DAY)} ngày`); }
    return { i, score, why };
  }).sort((a, b) => b.score - a.score || rank(a.i) - rank(b.i) || b.i.updated - a.i.updated);
}

/** CSV of the filtered list (not just the rows shown), visible columns, ID and title first. */
export function exportCsv(list: Ticket[], project: string, keys: ColKey[]) {
  const cell = (v: unknown) => { const s = String(v ?? ""); return '"' + (/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'; }; // = + - @ neutralised for spreadsheets
  const VAL: Record<ColKey, (i: Ticket) => unknown> = {
    id: (i) => i.id, type: (i) => i.type, summary: (i) => i.summary, state: (i) => i.state, priority: (i) => i.priority, assignee: (i) => i.assignee,
    qc: (i) => i.qc, sprint: (i) => i.sprints.join("; "), due: (i) => (i.due ? new Date(i.due).toLocaleDateString("vi-VN") : ""), updated: (i) => when(i.updated),
  };
  const ks: ColKey[] = ["id", "summary", ...keys.filter((k) => k !== "id" && k !== "summary")];
  const name = Object.fromEntries(COLS) as Record<ColKey, string>;
  const rows = [ks.map((k) => name[k]), ...list.map((i) => ks.map((k) => VAL[k](i)))];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" })); // BOM: Excel reads UTF-8
  a.download = `tickets-${project}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch {}
}
