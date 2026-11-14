"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t as tNow } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { getPref, put, readJson, saveYtRole, setPref, useRole, type YtRole } from "@/shared/lib/prefs";
import type { AiRun } from "./bits";
import type { AiSession } from "./history";
import { type AiReq, type ColKey, type Filters, type Group, GROUPS, isColKey, type Person, resolveProject, selfEdits, type Sprint, type Ticket, QUICK, UNASSIGNED, yt, ytMeQuery, ytProjectsQuery } from "@/features/youtrack/lib/yt";

// One context for the YouTrack page: project, data, filters (URL + localStorage, same keys as /yt/), mode, view prefs,
// the side sheet, and when each ticket entered its state.

export type Mode = YtRole;
export type Page = "home" | "tickets" | "dash" | "release" | "people" | "ai";
export type Scope = "me" | "team" | "group";
/** An AI run the AI session starts by itself: `seed` shows a saved answer instead (followed up from there), `onDone` keeps a new one. */
/** A session that waits for the user's first prompt (dashboard figures): `ask` runs it with that prompt. */
export type AiStart = { label: string; ask: (q: string, signal: AbortSignal) => ReturnType<AiRun["run"]> };
export type AiAuto = AiRun & { seed?: { text: string; req: AiReq | null }; onDone?: (r: { text: string; req: AiReq | null }) => void };
export type Sheet =
  | { kind: "ticket"; id: string; nav: string[]; comment?: string }
  | { kind: "list"; title: string; rows: Ticket[] }
  | { kind: "work"; title: string; ids: string[]; auto?: AiAuto; start?: AiStart; resume?: AiSession };

export { selfEdits };

export type TicketPatch = Partial<Ticket> & { id: string };
/** The newest save per ticket (`id`) and per field (`id:key`): an older answer or rollback never lands over a newer edit. */
const newest = new Map<string, number>();
let saves = 0;
/** Tickets with a save in flight (count per id): their cached values are not YouTrack's yet, the watch must not act on them. */
export const saving = new Map<string, number>();
const unsave = (id: string) => { const c = (saving.get(id) ?? 1) - 1; if (c > 0) saving.set(id, c); else saving.delete(id); };
/** Show an edit at once, settle on the server's answer; on error put the old values back (and say why). False on error.
 *  The newest save on a ticket takes YouTrack's whole answer (a State change can resolve it); an older one only its own fields.
 *  ponytail: a newest answer read before an older save landed can still hide that save until its own answer arrives. */
export async function saveTicket(patch: (t: TicketPatch) => Promise<void>, t: Ticket, local: Partial<Ticket>, call: () => Promise<Ticket>) {
  const n = ++saves, keys = Object.keys(local) as (keyof Ticket)[];
  for (const k of [t.id, ...keys.map((k) => `${t.id}:${k}`)]) newest.set(k, n);
  const own = (from: Partial<Ticket>) => ({ id: t.id, ...Object.fromEntries(keys.filter((k) => newest.get(`${t.id}:${k}`) === n).map((k) => [k, from[k] ?? null])) });
  const back = Object.fromEntries(keys.map((k) => [k, t[k] ?? null])) as Partial<Ticket>;
  saving.set(t.id, (saving.get(t.id) ?? 0) + 1);
  let r: Ticket;
  try { await patch({ id: t.id, ...local }); r = await call(); }
  catch (e) { unsave(t.id); await patch(own(back)); toast({ text: tNow("{id}: không đổi được — {msg}", { id: t.id, msg: (e as Error).message }) }); return false; }
  unsave(t.id);
  await patch(newest.get(t.id) === n ? r : own(r));
  return true;
}

const CAP = 150; // rows per step: the ticket table renders this many, then more as the end scrolls into view
const json = <T,>(k: string, d: T) => readJson(k, d) as T;
const asPage = (v: string | null): Page => (v === "dash" || v === "tickets" || v === "release" || v === "people" || v === "ai" ? v : "home");
const qp = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const TICKET_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/; // ?ticket= (URL or the bot's link): a ticket id, else ignored
const FILTER_PARAMS = ["sprint", "assignee", "state", "group", "sort", "everyone", "tier", "quick", "priority", "type", "q"];

type Stored = Omit<Filters, "assignee"> & { assignee: string[] | null }; // null = not chosen: the mode decides

function initialFilters(): Stored {
  const p = qp();
  const fromUrl = FILTER_PARAMS.some((k) => p.has(k));
  const s: Record<string, unknown> = fromUrl
    ? { sprint: p.getAll("sprint"), assignee: p.has("assignee") ? p.getAll("assignee") : p.has("everyone") ? [] : null, state: p.getAll("state"), group: p.get("group"), sort: p.get("sort"),
        tier: p.get("tier"), quick: p.get("quick"), priority: p.getAll("priority"), type: p.getAll("type"), q: p.get("q") ?? "" }
    : json<Record<string, unknown>>("ytFilters", {});
  if (!fromUrl && s.v !== 3) delete s.assignee; // older saves never chose an assignee
  const flt = fromUrl && (s.priority as string[]).length + (s.type as string[]).length ? s : json<Record<string, unknown>>("ytFlt", {});
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const [k, d] = String(s.sort ?? "").split(":");
  const g = String(s.group ?? "");
  return {
    sprint: arr(s.sprint), assignee: Array.isArray(s.assignee) ? arr(s.assignee) : null, state: arr(s.state),
    priority: arr(flt.priority), type: arr(flt.type), q: typeof s.q === "string" ? s.q : "",
    tier: ["0", "1", "2"].includes(String(s.tier)) ? (+String(s.tier) as 0 | 1 | 2) : null,
    quick: typeof s.quick === "string" && s.quick in QUICK ? s.quick : null,
    group: g === "none" || g in GROUPS ? (g as Group) : "sprint",
    sort: isColKey(k) && (d === "asc" || d === "desc") ? { k, d } : { k: "priority", d: "asc" },
  };
}

function usePref<T>(key: string, read: (v: string | null) => T, write: (v: T) => string) {
  const [v, setV] = useState<T>(() => read(getPref(key)));
  const set = useCallback((n: T) => { setV(n); setPref(key, write(n)); }, [key, write]);
  return [v, set] as const;
}
const bool = (on: boolean) => (v: string | null) => (v == null ? on : v === "1");
const b2s = (b: boolean) => (b ? "1" : "0");

function useYtState(embed?: string) { // embed: one ticket's sheet over another page (Telegram's ticket chip): no list, URL or seen marks
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["yt", "config"], queryFn: yt.config, staleTime: Infinity });
  const projects = useQuery(ytProjectsQuery);
  const meQ = useQuery(ytMeQuery);
  const me = meQ.data?.name ?? null;

  // a link's ?project= becomes the saved one: the ticket form and the shell's watch read the tab's project from the pref
  const [wanted, setProjectRaw] = useState(() => { const u = qp().get("project"); if (u) put("project", u); return u || getPref("project") || "VA"; });
  const ps = projects.data; // the saved project no longer exists: fall back to VA, else the first one
  const project = resolveProject(ps, wanted);

  // null: not chosen yet, the page asks first (and loads nothing); `mode` stands in as Dev for the code below
  const role = useRole();
  const mode: Mode = role ?? "dev";
  const [page, setPage] = useState<Page>(() => asPage(qp().get("view")));
  const [stored, setStored] = useState<Stored>(initialFilters);
  const [cap, setCap] = useState(CAP);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // ?ticket=VA-1 (a ticket chip in Telegram) opens that ticket's sheet
  const [sheet, setSheet] = useState<Sheet | null>(() => { const t = embed ?? qp().get("ticket"); return t && TICKET_ID.test(t) ? { kind: "ticket", id: t, nav: [] } : null; });
  useEffect(() => { // "Mở <trang>" in the know-it-all bot's answer (guide.tsx), already on YouTrack: that ticket or page, no reload
    const on = (e: Event) => {
      const q = (e as CustomEvent<URLSearchParams>).detail, id = q.get("ticket");
      if (id && TICKET_ID.test(id)) setSheet({ kind: "ticket", id, nav: [] });
      else setPage(asPage(q.get("view")));
    };
    addEventListener("guide-go", on);
    return () => removeEventListener("guide-go", on);
  }, []);
  const [newTicket, setNewTicket] = useState<string | null>(null); // the create dialog, open with this starting note

  const people = useQuery({ queryKey: ["yt", "people", project], queryFn: () => yt.people(project), staleTime: 10 * 60_000 });
  const sprintsQ = useQuery({ queryKey: ["yt", "sprints", project], queryFn: () => yt.sprints(project), staleTime: 10 * 60_000 });
  const sprints = useMemo(() => new Map((sprintsQ.data ?? []).map((s) => [s.name, s] as [string, Sprint])), [sprintsQ.data]);
  const loginOf = useMemo(() => new Map((people.data ?? []).map((p) => [p.name, p.login])), [people.data]);

  // the scope presets in the header: My task (me) / My team (me + saved members) / Group (saved members; none = everyone) ("" = a custom pick)
  const [members, setMembersRaw] = useState<string[]>(() => json<unknown[]>("ytTeam", []).filter((x): x is string => typeof x === "string"));
  const [group, setGroupRaw] = useState<string[]>(() => json<unknown[]>("ytGroup", []).filter((x): x is string => typeof x === "string"));
  const [pick, setPick] = useState<Scope | null>(null); // presets with the same people (an empty team is just me): the clicked one stays lit
  const team = useMemo(() => [...new Set([me, ...members].filter((n): n is string => !!n))], [me, members]);
  // Not chosen yet: Dev starts on my tickets, QA and PO on the group (QA tests tickets assigned to developers).
  const assignee = useMemo(() => stored.assignee ?? (mode === "dev" && me ? [me] : group), [stored.assignee, mode, me, group]);
  const filters: Filters = useMemo(() => ({ ...stored, assignee }), [stored, assignee]);
  const lists: Record<Scope, string[] | null> = { me: me ? [me] : null, team: me || members.length ? team : null, group };
  const same = (l: string[] | null) => !!l && l.length === assignee.length && l.every((n) => assignee.includes(n));
  const scope: Scope | "" = pick && same(lists[pick]) ? pick
    : (["me", "team", "group"] as const).find((s) => same(lists[s]) && (s !== "team" || members.length > 0)) ?? "";

  // Load only the people the filter shows ('me', 'unassigned', logins); everyone when the filter is empty.
  const whoOf = useCallback((names: string[]) => {
    if (!names.length) return null;
    const keys = names.map((n) => (n === UNASSIGNED ? "unassigned" : n === me ? "me" : loginOf.get(n)));
    return keys.every(Boolean) ? (keys as string[]).sort() : people.isPending ? undefined : null; // undefined: wait for logins; failed: everyone
  }, [me, loginOf, people.isPending]);
  const issuesQuery = useCallback((w: string[] | null) => ({
    queryKey: ["yt", "issues", project, w?.join(",") ?? "*"],
    queryFn: ({ signal }: { signal: AbortSignal }) => yt.issues(project, w, signal),
  }), [project]);
  const who = useMemo(() => whoOf(assignee), [whoOf, assignee]);
  const waitMe = stored.assignee === null && mode === "dev" && meQ.isPending;
  const issues = useQuery({
    ...issuesQuery(who ?? null),
    enabled: !embed && !!config.data && who !== undefined && !waitMe && !!role,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000, // background tabs wait until visible again
    // not isFetching / dataUpdatedAt: each refetch would re-render every useYt() reader (the header reads those itself)
    notifyOnChangeProps: ["data", "error", "isPending", "isError", "isSuccess", "isPlaceholderData"],
  });
  const rows = issues.data ?? EMPTY;
  // Warm the other scope presets once the current one is in, so switching tabs shows data at once instead of a dimmed wait.
  const loaded = issues.isSuccess && !issues.isPlaceholderData;
  useEffect(() => {
    if (!loaded) return;
    for (const w of [null, whoOf(team), whoOf(group), me ? whoOf([me]) : undefined]) // ponytail: re-fetched at most every 5 min; drop "all" if the project gets huge
      if (w !== undefined) void qc.prefetchQuery({ ...issuesQuery(w), staleTime: 5 * 60_000 });
  }, [loaded, qc, issuesQuery, whoOf, team, group, me]);

  function setFilters(patch: Partial<Filters>) {
    if (patch.assignee !== undefined) setPick(null);
    setStored((s) => ({ ...s, ...patch, assignee: patch.assignee !== undefined ? patch.assignee : s.assignee }));
    setCap(CAP);
  }
  function setScope(s: Scope) {
    setFilters({ assignee: lists[s] ?? [] });
    setPick(s);
  }
  function setMembers(names: string[]) {
    setPref("ytTeam", JSON.stringify(names));
    setMembersRaw(names);
    setStored((st) => ({ ...st, assignee: [...new Set([me, ...names].filter((n): n is string => !!n))] }));
    setPick("team");
  }
  function setGroup(names: string[]) {
    setPref("ytGroup", JSON.stringify(names));
    setGroupRaw(names);
    setStored((st) => ({ ...st, assignee: names }));
    setPick("group");
  }
  function setProject(p: string) {
    setPref("project", p);
    setProjectRaw(p);
    setStored((s) => ({ ...s, sprint: [], state: [], assignee: null }));
    setPicked(new Set());
  }
  const setMode = (m: Mode | null) => saveYtRole(m);
  // a new role (here or from Settings): its own default scope and home page
  const [seenRole, setSeenRole] = useState(role);
  if (seenRole !== role) {
    setSeenRole(role);
    setStored((s) => ({ ...s, assignee: null }));
    setPage("home");
  }

  // persist filters (localStorage, same keys as /yt/) and keep a shareable URL
  useEffect(() => {
    if (embed) return;
    const f = stored;
    put("ytFilters", JSON.stringify({ v: 3, state: f.state, sprint: f.sprint, ...(f.assignee ? { assignee: f.assignee } : {}), group: f.group, sort: `${f.sort.k}:${f.sort.d}`, tier: null, q: "" }));
    put("ytFlt", JSON.stringify({ priority: f.priority, type: f.type }));
    const p = new URLSearchParams();
    p.set("project", project);
    if (page !== "home") p.set("view", page);
    for (const k of ["sprint", "state", "priority", "type"] as const) f[k].forEach((v) => p.append(k, v));
    if (f.assignee) { if (f.assignee.length) f.assignee.forEach((v) => p.append("assignee", v)); else p.set("everyone", "1"); }
    if (f.q) p.set("q", f.q);
    if (f.tier != null) p.set("tier", String(f.tier));
    if (f.quick) p.set("quick", f.quick);
    if (f.group !== "sprint") p.set("group", f.group);
    if (f.sort.k !== "priority" || f.sort.d !== "asc") p.set("sort", `${f.sort.k}:${f.sort.d}`);
    try { history.replaceState(null, "", `?${p}`); } catch {}
  }, [stored, project, mode, page, embed]);

  // view prefs (same localStorage keys as /yt/)
  // columns per role: QA reads who tests and how fresh, PO reads due dates, Dev keeps the original default
  const colsOff = (d: ColKey[]) => (v: string | null) => { try { const a = JSON.parse(v ?? "null"); return Array.isArray(a) ? a.filter(isColKey) : d; } catch { return d; } };
  const cols = {
    dev: usePref<ColKey[]>("ytColsOff", colsOff(["due", "updated"]), JSON.stringify),
    qa: usePref<ColKey[]>("ytColsOffQa", colsOff(["due"]), JSON.stringify),
    po: usePref<ColKey[]>("ytColsOffPo", colsOff(["qc", "updated"]), JSON.stringify),
  };
  const [hiddenCols, setHiddenCols] = cols[mode];
  const [dense, setDense] = usePref("ytDense", bool(false), b2s);
  const [view, setView] = usePref<"table" | "board">("ytView", (v) => (v === "board" ? "board" : "table"), String);
  const [showRes, setShowRes] = usePref("ytRes", bool(true), b2s);
  const [hiOn, setHiOn] = usePref("ytHi", bool(true), b2s);
  const [range, setRange] = usePref("ytRange", (v) => ([7, 14, 30].includes(Number(v)) ? Number(v) : 14), String);
  const [wipPref, setWip] = usePref("ytWip", (v) => (Number(v) >= 2 && Number(v) <= 5 ? Number(v) : 0), String);
  const wip = wipPref || config.data?.t.wip || 3;
  const states = (d: string[]) => (v: string | null) => { try { const a = JSON.parse(v ?? "null"); return Array.isArray(a) ? a : d; } catch { return d; } };
  const devAging = usePref<string[]>("ytAgSt", states(["IN PROGRESS", "BUILT ON DEV"]), JSON.stringify);
  const qaAging = usePref<string[]>("ytAgStQa", states(["READY FOR TEST", "QC - QA", "QC"]), JSON.stringify); // QA watches how long tickets wait for test
  const [agingStates, setAgingStates] = mode === "qa" ? qaAging : devAging;

  // "new since your last visit": tickets updated after the last time this project was looked at
  const seen = useMemo(() => Number(getPref(`ytSeen:${project}`)) || 0, [project]);
  useEffect(() => {
    if (embed) return;
    const save = () => { if (document.visibilityState === "hidden") setPref(`ytSeen:${project}`, String(Date.now())); };
    document.addEventListener("visibilitychange", save);
    addEventListener("pagehide", save);
    return () => { document.removeEventListener("visibilitychange", save); removeEventListener("pagehide", save); setPref(`ytSeen:${project}`, String(Date.now())); };
  }, [project, embed]);

  // when each ticket entered its current state: fetched 100 at a time, one request at a time; keyed by id@updated
  const [sinceMap, setSinceMap] = useState<Map<string, number>>(new Map());
  const tried = useRef(new Set<string>());
  const chain = useRef(Promise.resolve());
  const [sinceBusy, setSinceBusy] = useState(0);
  const [sinceError, setSinceError] = useState<Error | null>(null); // the server re-raises a refused token: show it, not "no data"
  const since = useCallback((i: Ticket) => sinceMap.get(`${i.id}@${i.updated}`) ?? null, [sinceMap]);
  const loadSince = useCallback((list: Ticket[]) => {
    const todo = list.filter((i) => !tried.current.has(`${i.id}@${i.updated}`));
    for (let n = 0; n < todo.length; n += 100) {
      const batch = todo.slice(n, n + 100), keys = batch.map((i) => `${i.id}@${i.updated}`);
      keys.forEach((k) => tried.current.add(k));
      setSinceBusy((b) => b + 1);
      chain.current = chain.current.then(() => yt.since(keys).then((r) => { setSinceError(null); setSinceMap((m) => {
        const next = new Map(m);
        for (const i of batch) if (r[i.id] != null) next.set(`${i.id}@${i.updated}`, +r[i.id] || i.created || i.updated);
        return next;
      }); }).catch((e: Error) => { keys.forEach((k) => tried.current.delete(k)); setSinceError(e); }).finally(() => setSinceBusy((b) => b - 1)));
    }
  }, []);

  /** Write the server's answer into every cached list and the open detail (after an assignee / state / priority change). */
  const patchTicket = useCallback(async (t: TicketPatch) => {
    selfEdits.set(t.id, Date.now());
    qc.setQueryData<Ticket>(["yt", "detail", t.id], (old) => old && { ...old, ...t });
    await qc.cancelQueries({ queryKey: ["yt", "issues", project] }); // a list fetched before the edit would put the old value back
    qc.setQueriesData<Ticket[]>({ queryKey: ["yt", "issues", project] }, (old) => old?.map((i) => (i.id === t.id ? { ...i, ...t } : i)));
  }, [qc, project]);
  const refresh = () => {
    setSinceError(null);
    void qc.invalidateQueries({ queryKey: ["yt", "issues", project] });
    void qc.invalidateQueries({ queryKey: ["yt", "sprints", project] });
    qc.removeQueries({ queryKey: ["yt", "detail"] });
  };

  // sprint options, most recently used first; people options from the team, else whoever appears in the data
  const sprintOptions = useMemo(() => {
    const last: Record<string, number> = {};
    for (const i of rows) for (const s of i.sprints) last[s] = Math.max(last[s] || 0, i.updated);
    return [...new Set([...Object.keys(last).sort((a, b) => last[b] - last[a]), ...stored.sprint])];
  }, [rows, stored.sprint]);
  const peopleOptions = useMemo(() => {
    const names = people.data?.length ? people.data.map((p) => p.name) : [...new Set(rows.map((i) => i.assignee).filter((n): n is string => !!n))];
    return [...new Set([UNASSIGNED, ...names.sort((a, b) => a.localeCompare(b, "vi")), ...assignee])];
  }, [people.data, rows, assignee]);

  const aiOn = !!config.data?.ai && !config.data.mock;

  return {
    config: config.data, configError: config.error, sinceError, issuesKey: issuesQuery(who ?? null).queryKey, projects: projects.data ?? [], project, setProject, me, people: people.data ?? NO_PEOPLE, loginOf,
    sprints, sprintOptions, peopleOptions, rows, issues, refresh, filters, setFilters, team, members, setMembers, group, setGroup, scope, setScope, role, mode, setMode, page, setPage, cap, setCap,
    picked, setPicked, sheet, setSheet, newTicket, setNewTicket, aiOn, seen, since, loadSince, sinceBusy: sinceBusy > 0, patchTicket,
    hiddenCols, setHiddenCols, dense, setDense, view, setView, showRes, setShowRes, hiOn, setHiOn, range, setRange, wip, setWip, agingStates, setAgingStates,
    openTicket: (id: string, list?: Ticket[]) => setSheet((s) => ({ kind: "ticket", id, nav: list ? list.map((i) => i.id) : s?.kind === "ticket" ? s.nav : [] })),
  };
}
const EMPTY: Ticket[] = [];
const NO_PEOPLE: Person[] = [];
export const CAP_STEP = CAP;

export type Yt = ReturnType<typeof useYtState>;
const Ctx = createContext<Yt | null>(null);
export function YtProvider({ children, embed }: { children: React.ReactNode; embed?: string }) {
  return <Ctx value={useYtState(embed)}>{children}</Ctx>;
}
export const useYt = () => use(Ctx)!;
