import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AiAccount, type AiCatalogEntry, type AiPicks, type AiPrefs, api, type ClaudeAccount } from "@/shared/lib/api";
import { t, useLang } from "@/shared/lib/i18n";
import { byUnit } from "@/shared/lib/time";

// The AI CLIs' shared state: which one runs each kind of run, the catalog, each CLI's picks and logins.

export type Provider = AiPrefs["use"]["chat"];
export type Effort = AiPicks["effort"];
/** Which saved picks a run uses (providers.run_choice): drafts, Briefing / Digest, tasks / AI Agent, YouTrack light / heavy, the know-it-all bot. */
export type RunKind = keyof AiPrefs["use"];
/** The kind whose picks a "" pick falls back to (Briefing, YouTrack light: drafts; YouTrack heavy: tasks). */
export const BASE: Record<RunKind, "chat" | "task"> = { chat: "chat", brief: "chat", task: "task", yt: "chat", yt_task: "task", guide: "chat" };
/** A kind's model / effort keys in a CLI's picks. */
export const KEYS = {
  chat: ["model", "effort"], brief: ["brief_model", "brief_effort"], task: ["task_model", "task_effort"],
  yt: ["yt_model", "yt_effort"], yt_task: ["yt_task_model", "yt_task_effort"], guide: ["guide_model", "guide_effort"],
} as const satisfies Record<RunKind, readonly [keyof AiPicks, keyof AiPicks]>;
export const PROVIDERS: Provider[] = ["claude", "codex", "antigravity"];
const NO_PICKS: AiPicks = {
  model: "", effort: "", task_model: "", task_effort: "", brief_model: "", brief_effort: "",
  yt_model: "", yt_effort: "", yt_task_model: "", yt_task_effort: "", guide_model: "", guide_effort: "",
};
const EFFORT_LABELS: Record<Exclude<Effort, "">, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" };
/** An effort's name ("" = the CLI's default), in the current language: call from a component that uses `useT`. */
export const effortLabel = (e: Effort) => (e ? EFFORT_LABELS[e] : t("Mặc định"));

/** Which CLI runs each kind of run, what each CLI offers, and each CLI's own picks (kept when switching): every AI surface reads this.
 *  A model pick is "<cli>:<model>" over every CLI's models: picking it picks its CLI for that kind ("" = like the base kind). */
export function useAiPrefs() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["ai-prefs"], queryFn: ({ signal }) => api<AiPrefs>("/ai/prefs", { signal }) });
  const catalog = useQuery({ queryKey: ["ai-catalog"], queryFn: ({ signal }) => api<AiCatalogEntry[]>("/ai/catalog", { signal }), staleTime: 5 * 60_000 });
  const save = useMutation({
    scope: { id: "ai-prefs" }, // one PUT at a time: a dragged slider must not land its steps out of order
    mutationFn: (next: AiPrefs) => api<AiPrefs>("/ai/prefs", { method: "PUT", json: next }),
    onMutate: (next) => qc.setQueryData(["ai-prefs"], next),
    onError: () => void qc.invalidateQueries({ queryKey: ["ai-prefs"] }),
  });
  const p = prefs.data;
  const on = (k: RunKind): Provider => p?.use[k] || p?.use[BASE[k]] || "claude";
  const info = (id: Provider) => catalog.data?.find((c) => c.id === id);
  const picks = (id: Provider) => p?.by[id] ?? NO_PICKS;
  return {
    p, save, isError: prefs.isError || catalog.isError, catalog: catalog.data,
    info, on, nameOf: (k: RunKind = "chat") => info(on(k))?.name ?? "AI",
    /** Every CLI some kind of run uses. */
    used: () => PROVIDERS.filter((id) => (Object.keys(BASE) as RunKind[]).some((k) => on(k) === id)),
    picks,
    /** A kind's model pick as "<cli>:<model>", or "" when it is its base kind's. */
    modelOf: (k: RunKind) => {
      const id = on(k), m = picks(id)[KEYS[k][0]];
      return BASE[k] === k || m || (p?.use[k] && id !== on(BASE[k])) ? `${id}:${m}` : "";
    },
    setModel: (k: RunKind, v: string) => {
      if (!p) return;
      const m = KEYS[k][0], i = v.indexOf(":");
      if (i < 0) { // "" (not a base kind): back to the base kind's pick, on its CLI
        const by = { ...p.by };
        for (const id of [on(k), on(BASE[k])]) by[id] = { ...picks(id), [m]: "" };
        return save.mutate({ ...p, use: { ...p.use, [k]: "" }, by });
      }
      const id = v.slice(0, i) as Provider;
      save.mutate({ ...p, use: { ...p.use, [k]: id }, by: { ...p.by, [id]: { ...picks(id), [m]: v.slice(i + 1) } } });
    },
    set: (patch: Partial<AiPrefs>) => p && save.mutate({ ...p, ...patch }),
    setPicks: (id: Provider, patch: Partial<AiPicks>) => p && save.mutate({ ...p, by: { ...p.by, [id]: { ...picks(id), ...patch } } }),
  };
}

const PLANS: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };
const OTHER_PLANS: Record<string, string> = { plus: "Plus", pro: "Pro", team: "Team", business: "Business", enterprise: "Enterprise", free: "Free" };

export const planName = (a: ClaudeAccount) => PLANS[a.subscriptionType ?? ""] ?? a.subscriptionType ?? a.authMethod ?? "—";
export const planTier = (a: ClaudeAccount) => /max_(\d+x)/.exec(a.rate_tier ?? "")?.[1];

export function planLabel(a: ClaudeAccount) {
  const tier = planTier(a);
  return tier ? t("{plan}, hạn mức Max {tier}", { plan: planName(a), tier }) : planName(a);
}

// The backend's short window labels (kept short for the top-bar pill), spelled out for the account page.
/** "5h" / "1w", optionally "· <models>" ("1w · Opus", "5h · Gemini"), as a row title. */
export const windowName = (label: string) => label.replace(/^5h/, t("Phiên 5 giờ")).replace(/^1w/, t("7 ngày")).replace(" · ", ", ");

export const sectionHead = "text-xs font-bold text-ink";
/** A raised card on the AI page. */
export const card = "grid gap-4 rounded-lg bg-cotton p-4 shadow-stock";

/** One shared query; each viewer sets its own poll (react-query runs the shortest). Paused in hidden tabs. */
export function useClaudeAccount(every: number | false = false) {
  return useQuery({
    queryKey: ["claude-account"],
    queryFn: ({ signal }) => api<ClaudeAccount>("/claude/account", { signal }),
    refetchInterval: (q) => (q.state.data?.login_pending ? 2000 : every), // 2s until the browser finishes
  });
}

/** Codex and Antigravity logins: checked every `every` ms, every 2s while a started login waits for the browser. */
function useOtherAccounts(every: number | false = false) {
  return useQuery({
    queryKey: ["ai-accounts"],
    queryFn: ({ signal }) => api<AiAccount[]>("/ai/accounts", { signal }),
    refetchInterval: (q) => (q.state.data?.some((a) => a.login_pending) ? 2000 : every),
  });
}

/** One CLI's login in one shape, whichever CLI it is. */
export type AccountView = {
  checking: boolean; installed: boolean; loggedIn: boolean; email?: string | null; plan?: string | null;
  pending: boolean; url?: string | null; install: string; usage: ClaudeAccount["usage"]; usage_at?: string | null;
  /** "no_token": not live, `usage` is the last reading (Claude only). */
  usage_error?: string | null;
  /** Free "reset my limits now" credits (Codex): the listed ones (maybe capped) and how many in all. */
  resets: AiAccount["resets"]; resets_left: number;
  /** Why no resets are listed: "cli_version" = the CLI is too old to be offered them (Claude only). */
  resets_blocked?: string | null;
};

/** Every CLI's login, keyed by CLI. */
export function useAccounts(every: number | false = false): Record<Provider, AccountView> {
  useLang(); // the plan label is in the current language
  const c = useClaudeAccount(every);
  const o = useOtherAccounts(every);
  const { info } = useAiPrefs();
  const other = (id: Provider): AccountView => {
    const a = o.data?.find((x) => x.provider === id);
    return {
      checking: !a && !o.isError, installed: !!a?.installed, loggedIn: !!a?.loggedIn, email: a?.email,
      plan: a && (OTHER_PLANS[a.plan ?? ""] ?? a.plan ?? a.method), pending: !!a?.login_pending, url: a?.login_url, install: a?.install ?? info(id)?.install ?? "",
      usage: a?.usage ?? [], usage_at: a?.usage_at, resets: a?.resets ?? [], resets_left: a?.resets_left ?? 0,
    };
  };
  return {
    claude: {
      checking: !c.data && !c.isError, installed: !c.isError, loggedIn: !!c.data?.loggedIn, email: c.data?.email,
      plan: c.data && planLabel(c.data), pending: !!c.data?.login_pending, url: c.data?.login_url, install: info("claude")?.install ?? "",
      usage: c.data?.usage ?? [], usage_at: c.data?.usage_at, usage_error: c.data?.usage_error,
      resets: c.data?.resets ?? [], resets_left: c.data?.resets_left ?? 0, resets_blocked: c.data?.resets_blocked,
    },
    codex: other("codex"),
    antigravity: other("antigravity"),
  };
}

/** Read every login (and Codex's model list) again, e.g. after installing a CLI. */
export function useRecheck() {
  const qc = useQueryClient();
  return () => { for (const k of ["claude-account", "ai-accounts", "ai-catalog"]) void qc.invalidateQueries({ queryKey: [k] }); };
}

/** 0 ok, 1 amber from 70% used, 2 red from 90%: one threshold for every quota meter. */
const level = (pct: number) => (pct >= 90 ? 2 : pct >= 70 ? 1 : 0);
export const meterTone = (pct: number) => (["bg-hl", "bg-warn", "bg-error"] as const)[level(pct)];
/** The same tone as text colour (a ring's stroke = currentColor). */
export const ringTone = (pct: number) => (["text-hl", "text-warn", "text-error"] as const)[level(pct)];

/** Time until a window resets, in its largest whole unit ("3 giờ"). */
export const resetIn = (iso: string, now: number) => byUnit(Math.ceil(Math.max(0, (Date.parse(iso) - now) / 60_000))).join(" ");
