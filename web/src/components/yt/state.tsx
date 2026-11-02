"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPref, setPref } from "@/lib/prefs";
import { type ColKey, type Filters, type Group, GROUPS, isColKey, type Sprint, type Ticket, UNASSIGNED, yt } from "@/lib/yt";

// One context for the YouTrack page: project, data, filters (URL + localStorage, same keys as /yt/), mode, view prefs,
// the side sheet, and when each ticket entered its state.

export type Mode = "dev" | "lead";
export type Page = "home" | "tickets" | "dash";
export type Sheet =
  | { kind: "ticket"; id: string; nav: string[] }
  | { kind: "list"; title: string; rows: Ticket[] }
  | { kind: "ai"; title: string; label: string; run: (signal: AbortSignal) => Promise<{ text: string }> };

export const ANDROID_TEAM = ["Lễ Tất Dũng"]; // exact YouTrack full names; "Android team" = the current user + these people
const CAP = 600;
const json = <T,>(k: string, d: T): T => { try { return JSON.parse(getPref(k) ?? "null") ?? d; } catch { return d; } };
const qp = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const FILTER_PARAMS = ["sprint", "assignee", "state", "group", "sort", "everyone", "tier", "priority", "type", "q"];

type Stored = Omit<Filters, "assignee"> & { assignee: string[] | null }; // null = not chosen: the mode decides

function initialFilters(): Stored {
  const p = qp();
  const fromUrl = FILTER_PARAMS.some((k) => p.has(k));
  const s: Record<string, unknown> = fromUrl
    ? { sprint: p.getAll("sprint"), assignee: p.has("assignee") ? p.getAll("assignee") : p.has("everyone") ? [] : null, state: p.getAll("state"), group: p.get("group"), sort: p.get("sort"),
        tier: p.get("tier"), priority: p.getAll("priority"), type: p.getAll("type"), q: p.get("q") ?? "" }
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

function useYtState() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["yt", "config"], queryFn: yt.config, staleTime: Infinity });
  const projects = useQuery({ queryKey: ["yt", "projects"], queryFn: yt.projects, staleTime: Infinity });
  const meQ = useQuery({ queryKey: ["yt", "me"], queryFn: yt.me, staleTime: Infinity });
  const me = meQ.data?.name ?? null;

  const [wanted, setProjectRaw] = useState(() => qp().get("project") || getPref("project") || "VA");
  const ps = projects.data; // the saved project no longer exists: fall back to VA, else the first one
  const project = !ps?.length || ps.some((p) => p.shortName === wanted) ? wanted : ps.find((p) => p.shortName === "VA")?.shortName ?? ps[0].shortName;

  const [mode, setModeRaw] = useState<Mode>(() => { const m = qp().get("mode") || getPref("ytMode"); return m === "lead" ? "lead" : "dev"; });
  const [page, setPage] = useState<Page>(() => { const v = qp().get("view"); return v === "dash" ? "dash" : v === "tickets" ? "tickets" : "home"; });
  const [stored, setStored] = useState<Stored>(initialFilters);
  const [cap, setCap] = useState(CAP);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [tv, setTv] = useState(false);

  const people = useQuery({ queryKey: ["yt", "people", project], queryFn: () => yt.people(project), staleTime: 10 * 60_000 });
  const sprintsQ = useQuery({ queryKey: ["yt", "sprints", project], queryFn: () => yt.sprints(project), staleTime: 10 * 60_000 });
  const sprints = useMemo(() => new Map((sprintsQ.data ?? []).map((s) => [s.name, s] as [string, Sprint])), [sprintsQ.data]);
  const loginOf = useMemo(() => new Map((people.data ?? []).map((p) => [p.name, p.login])), [people.data]);

  // Not chosen yet: Dev starts on my tickets, Lead on everyone's.
  const assignee = useMemo(() => stored.assignee ?? (mode === "dev" && me ? [me] : []), [stored.assignee, mode, me]);
  const filters: Filters = useMemo(() => ({ ...stored, assignee }), [stored, assignee]);

  // Load only the people the filter shows ('me', 'unassigned', logins); everyone when the filter is empty.
  const who = useMemo(() => {
    if (!assignee.length) return null;
    const keys = assignee.map((n) => (n === UNASSIGNED ? "unassigned" : n === me ? "me" : loginOf.get(n)));
    return keys.every(Boolean) ? (keys as string[]).sort() : people.isSuccess ? null : undefined; // undefined: wait for logins
  }, [assignee, me, loginOf, people.isSuccess]);
  const waitMe = stored.assignee === null && mode === "dev" && meQ.isPending;
  const issues = useQuery({
    queryKey: ["yt", "issues", project, who?.join(",") ?? "*"],
    queryFn: ({ signal }) => yt.issues(project, who ?? null, signal),
    enabled: !!config.data && who !== undefined && !waitMe,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000, // background tabs wait until visible again
  });
  const rows = issues.data ?? EMPTY;

  function setFilters(patch: Partial<Filters>) {
    setStored((s) => ({ ...s, ...patch, assignee: patch.assignee !== undefined ? patch.assignee : s.assignee }));
    setCap(CAP);
  }
  function setProject(p: string) {
    setPref("project", p);
    setProjectRaw(p);
    setStored((s) => ({ ...s, sprint: [], state: [], assignee: null }));
    setPicked(new Set());
  }
  function setMode(m: Mode) {
    setPref("ytMode", m);
    setModeRaw(m);
    setStored((s) => ({ ...s, assignee: null })); // the scope follows the new mode
    setPage("home");
  }

  // persist filters (localStorage, same keys as /yt/) and keep a shareable URL
  useEffect(() => {
    const f = stored;
    setPref("ytFilters", JSON.stringify({ v: 3, state: f.state, sprint: f.sprint, ...(f.assignee ? { assignee: f.assignee } : {}), group: f.group, sort: `${f.sort.k}:${f.sort.d}`, tier: null, q: "" }));
    setPref("ytFlt", JSON.stringify({ priority: f.priority, type: f.type }));
    const p = new URLSearchParams();
    p.set("project", project);
    if (mode === "lead") p.set("mode", "lead");
    if (page !== "home") p.set("view", page);
    for (const k of ["sprint", "state", "priority", "type"] as const) f[k].forEach((v) => p.append(k, v));
    if (f.assignee) { if (f.assignee.length) f.assignee.forEach((v) => p.append("assignee", v)); else p.set("everyone", "1"); }
    if (f.q) p.set("q", f.q);
    if (f.tier != null) p.set("tier", String(f.tier));
    if (f.group !== "sprint") p.set("group", f.group);
    if (f.sort.k !== "priority" || f.sort.d !== "asc") p.set("sort", `${f.sort.k}:${f.sort.d}`);
    try { history.replaceState(null, "", `?${p}`); } catch {}
  }, [stored, project, mode, page]);

  // view prefs (same localStorage keys as /yt/)
  const [hiddenCols, setHiddenCols] = usePref<ColKey[]>("ytColsOff", (v) => { try { const a = JSON.parse(v ?? "null"); return Array.isArray(a) ? a.filter(isColKey) : ["due", "updated"]; } catch { return ["due", "updated"]; } }, JSON.stringify);
  const [dense, setDense] = usePref("ytDense", bool(false), b2s);
  const [showRes, setShowRes] = usePref("ytRes", bool(true), b2s);
  const [hiOn, setHiOn] = usePref("ytHi", bool(true), b2s);
  const [range, setRange] = usePref("ytRange", (v) => ([7, 14, 30].includes(Number(v)) ? Number(v) : 14), String);
  const [wipPref, setWip] = usePref("ytWip", (v) => (Number(v) >= 2 && Number(v) <= 5 ? Number(v) : 0), String);
  const wip = wipPref || config.data?.t.wip || 3;
  const [agingStates, setAgingStates] = usePref<string[]>("ytAgSt", (v) => { try { const a = JSON.parse(v ?? "null"); return Array.isArray(a) ? a : ["IN PROGRESS", "BUILT ON DEV"]; } catch { return ["IN PROGRESS", "BUILT ON DEV"]; } }, JSON.stringify);

  // "new since your last visit": tickets updated after the last time this project was looked at
  const seen = useMemo(() => Number(getPref(`ytSeen:${project}`)) || 0, [project]);
  useEffect(() => {
    const save = () => { if (document.visibilityState === "hidden") setPref(`ytSeen:${project}`, String(Date.now())); };
    document.addEventListener("visibilitychange", save);
    addEventListener("pagehide", save);
    return () => { document.removeEventListener("visibilitychange", save); removeEventListener("pagehide", save); setPref(`ytSeen:${project}`, String(Date.now())); };
  }, [project]);

  // when each ticket entered its current state: fetched 100 at a time, one request at a time; keyed by id@updated
  const [sinceMap, setSinceMap] = useState<Map<string, number>>(new Map());
  const tried = useRef(new Set<string>());
  const chain = useRef(Promise.resolve());
  const [sinceBusy, setSinceBusy] = useState(0);
  const since = useCallback((i: Ticket) => sinceMap.get(`${i.id}@${i.updated}`) ?? null, [sinceMap]);
  const loadSince = useCallback((list: Ticket[]) => {
    const todo = list.filter((i) => !tried.current.has(`${i.id}@${i.updated}`));
    for (let n = 0; n < todo.length; n += 100) {
      const batch = todo.slice(n, n + 100), keys = batch.map((i) => `${i.id}@${i.updated}`);
      keys.forEach((k) => tried.current.add(k));
      setSinceBusy((b) => b + 1);
      chain.current = chain.current.then(() => yt.since(keys).then((r) => setSinceMap((m) => {
        const next = new Map(m);
        for (const i of batch) if (r[i.id] != null) next.set(`${i.id}@${i.updated}`, +r[i.id] || i.created || i.updated);
        return next;
      })).catch(() => {}).finally(() => setSinceBusy((b) => b - 1)));
    }
  }, []);

  /** Write the server's answer into every cached list (after an assignee change). */
  function patchTicket(t: Ticket) {
    qc.setQueriesData<Ticket[]>({ queryKey: ["yt", "issues", project] }, (old) => old?.map((i) => (i.id === t.id ? { ...i, ...t } : i)));
    qc.removeQueries({ queryKey: ["yt", "detail", t.id] });
  }
  const refresh = () => {
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
    config: config.data, configError: config.error, projects: projects.data ?? [], project, setProject, me, people: people.data ?? [], loginOf,
    sprints, sprintOptions, peopleOptions, rows, issues, refresh, filters, setFilters, mode, setMode, page, setPage, cap, setCap,
    picked, setPicked, sheet, setSheet, tv, setTv, aiOn, seen, since, loadSince, sinceBusy: sinceBusy > 0, patchTicket,
    hiddenCols, setHiddenCols, dense, setDense, showRes, setShowRes, hiOn, setHiOn, range, setRange, wip, setWip, agingStates, setAgingStates,
    openTicket: (id: string, list?: Ticket[]) => setSheet((s) => ({ kind: "ticket", id, nav: list ? list.map((i) => i.id) : s?.kind === "ticket" ? s.nav : [] })),
  };
}
const EMPTY: Ticket[] = [];
export const CAP_STEP = CAP;

export type Yt = ReturnType<typeof useYtState>;
const Ctx = createContext<Yt | null>(null);
export function YtProvider({ children }: { children: React.ReactNode }) {
  return <Ctx value={useYtState()}>{children}</Ctx>;
}
export const useYt = () => use(Ctx)!;
