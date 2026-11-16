"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, RefreshCw, RotateCw, Sparkles, Trash2, TriangleAlert, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAiWait } from "@/shared/components/ai/fetching";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogTitle, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { useLang, useT } from "@/shared/lib/i18n";
import { getPref, put } from "@/shared/lib/prefs";
import { packShots, useUiFlow, zeplinUrls } from "@/features/youtrack/lib/uiflow";
import { AI_LEAVE, aiJobs, aiParts, fileUrl, flowSignals, flowCursors, type FlowJob, type FlowJobState, type FlowSaved, type FlowManifest, type FlowMode, type FlowTarget, newJobId, type UiFlow, yt, ytFlowQuery } from "@/features/youtrack/lib/yt";
import { flowDraft, type FlowDraft } from "@/features/youtrack/lib/flow-draft";
import { cn } from "@/shared/lib/utils";
import { YtFetching } from "./bits";
import { FlowRisks, platformSkip, useFlowCheck } from "./flow-check";
import { FlowStart, FlowTargetPicker } from "./flow-start";

/** The head line of the dialog: what the file is now (one state, its colour, a hint on what to do next). */
const STATUS = {
  running: { label: "Đang render", hint: "Lượt AI đang chạy, xem tiến độ bên dưới", tone: "bg-hl-wash text-hl-2" },
  interrupted: { label: "Bị gián đoạn", hint: "Bấm “Tiếp tục render” để chạy lại", tone: "bg-warn/15 text-warn" },
  failed: { label: "Lỗi render", hint: "Xem lý do ở thẻ lỗi, rồi bấm render để thử lại", tone: "bg-error/10 text-error" },
  unsaved: { label: "Chưa lưu", hint: "Sơ đồ chỉ nằm trong bản nháp, chưa lên ticket", tone: "bg-warn/15 text-warn" },
  flow: { label: "Đã có sơ đồ", hint: "Kéo thả để sửa; lưu lên ticket bằng Cập nhật", tone: "bg-paper-3 text-ink-2" },
  empty: { label: "Chưa có", hint: "Chọn cách dựng ở giữa, rồi bấm nút bên dưới", tone: "bg-paper-3 text-ink-3" },
} as const;
import { type FlowEvent, FlowProgress, flowStage, flowSummary } from "./flow-progress";

// The ticket's UI flow: the file on the ticket drawn by the engine (web/public/uiflow.js), one AI run to build it, and
// the bar that uploads what changed back. The dialog orchestrates; the calls live in lib/yt, the engine in lib/uiflow.

/** The server's own words for a failed call (ytApi already translated the codes it knows); `status` for the 409. */
const say = (e: unknown) => (e as Error).message;
const statusOf = (e: unknown) => (e as { status?: number } | null | undefined)?.status;
const CHANGES_MS = 4000;

export function FlowDialog(props: { issue: string; open: boolean; onClose: () => void }) {
  const t = useT();
  // Revalidating scope unmounts this editor; preserve its operation locks until close. Mutations verify scope explicitly.
  const scope = useQuery({ queryKey: ["yt", "flow-scope"], queryFn: yt.flowScope, retry: false, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (scope.isFetching || scope.isError || !scope.data) return <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}><DialogContent><DialogTitle>{t("UI flow {id}", { id: props.issue })}</DialogTitle>{scope.isError ? <Center><p role="alert">{say(scope.error)}</p><Button onClick={() => void scope.refetch()}>{t("Thử lại")}</Button></Center> : <YtFetching kind="flow" />}</DialogContent></Dialog>;
  return <ScopedFlowDialog key={`${scope.data.scope}:${props.issue}`} {...props} scope={scope.data.scope} />;
}

function ScopedFlowDialog({ issue, open, onClose, scope }: { issue: string; open: boolean; onClose: () => void; scope: string }) {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const draft = useRef<FlowDraft | null>(null);
  const draftWrite = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [job, setJob] = useState<FlowJobState | null>(null);
  const [jobError, setJobError] = useState("");
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef<string | null>(null);
  const pendingJob = useRef<FlowJob | null>(null);
  const cursor = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const operation = useRef(0);
  const busy = useRef(false);
  const [unknownSave, setUnknownSave] = useState(false);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  // the flow being shown over the ticket's own: an AI result, not saved yet (`base`: the file it would replace)
  // (`sum`: what the AI drew and could not read, for the bar under a fresh render)
  const [mine, setMine] = useState<{ flow: UiFlow; manifest?: FlowManifest | null; base: string | null; sum?: ReturnType<typeof flowSummary> } | null>(null);
  const [dirty, setDirty] = useState(false); // the engine's edits since it was last given a flow
  const [hid, setHid] = useState(false); // "Không": the bar stays away until the next edit or "Cập nhật lên ticket"
  const [saved, setSaved] = useState<FlowSaved | null>(null);
  const [ask, setAsk] = useState<"again" | "fresh" | "delete" | null>(null);
  // "screens": the Zeplin screens built by code (no AI, no token); "flow": + the links an AI reads from the AC, on the
  // model / effort the user picks in the box. Remembered per browser.
  const [mode, setMode] = useState<FlowMode>(() => (getPref("uiflowMode") === "flow" ? "flow" : "screens")); // default: screens, 0 token
  const [runMode, setRunMode] = useState<FlowMode>(mode); // the mode of the run on screen (a resumed one: as it started)
  const [risky, setRisky] = useState(false);
  // "Render lại": keep the flow's links and ask the AI only for what is new (default), or draw it all again
  const [reuse, setReuse] = useState(true);
  // what the next new run asks for beyond the box ("Chỉ dựng màn" / "Chia phần" / "Chỉ vẽ phần mới"), read once
  const runOpts = useRef<{ mode?: FlowMode; split?: boolean; reuse?: boolean; note?: string; skip?: string[] }>({});
  const [shown, setShown] = useState(true); // false: sliding out; `onClose` comes when that animation ends

  // Background attachment refresh would replace engine-only edits; reopen, explicit refresh and save reconcile metadata.
  const q = useQuery({ ...ytFlowQuery(issue, scope), enabled: open, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const flow = mine?.flow ?? q.data?.flow ?? null;
  const base = mine ? mine.base : q.data?.att ?? null;
  // the Zeplin screens the flow links (edits included): frames drawn from their images; the engine mounts once the
  // first answer is in (or failed), so it lays out with them and never shifts frames under the user
  const [edited, setEdited] = useState<string | null>(null); // the edited flow's links, "\n"-joined
  const urls = edited !== null ? edited.split("\n").filter(Boolean) : zeplinUrls(flow);
  const sq = useQuery({
    queryKey: ["yt", "flow-shots", scope, ...urls], queryFn: ({ signal }) => yt.flowShots(urls, signal),
    enabled: open && !!flow && urls.length > 0, staleTime: 30 * 60_000, retry: false, placeholderData: keepPreviousData,
  });
  const shotsReady = !urls.length || !!sq.data || sq.isError;
  // the screens whose Zeplin design changed since the file was saved (its size or its texts): = design_of in flow.py
  const was0 = q.data?.flow?.design, live = sq.data?.shots;
  const redesigned = !was0 || !live || !q.data?.flow ? [] : q.data.flow.screens.filter((s) => {
    const was = s.zeplin && was0[s.zeplin], now = s.zeplin && live[s.zeplin];
    if (!was || !now) return false;
    const sig = [`${Math.round(now.w)}x${Math.round(now.h)}`, ...new Set(now.hits.map((x) => x[0]))];
    return sig.length !== was.length || sig.some((x) => !was.includes(x));
  });
  const persist = (value: FlowDraft | null, immediate = false) => {
    const writeId = ++draftWrite.current;
    draft.current = value;
    if (timer.current) clearTimeout(timer.current);

    setDraftStatus(t("Đang lưu bản nháp…"));
    const write = () => { timer.current = null; void flowDraft(scope, issue, draft.current).then(() => { if (writeId === draftWrite.current) setDraftStatus(t("Đã lưu bản nháp")); }, (e) => { if (writeId === draftWrite.current) setDraftStatus(t("Không lưu được bản nháp: {msg}", { msg: say(e) })); }); };
    if (immediate) write(); else timer.current = setTimeout(write, 500);
  };
  // "Xem thay đổi": what Cập nhật would write, read before writing 
  const diff = useMutation({ mutationFn: (f: UiFlow) => yt.flowDiff(issue, f, base) });
  const engine = useUiFlow(el, shotsReady ? flow : null, {
    lang, shots: sq.data?.shots,
    onChange: (f, d) => {
      setDirty(d);
      diff.reset(); // what it listed was the flow before this edit
      if (d) { setHid(false); persist({ flow: f, manifest: mine?.manifest, base, job: draft.current?.job ?? job?.id, pendingJob: draft.current?.pendingJob, outcomeUnknown: draft.current?.outcomeUnknown, updated: Date.now() }); }
      else if (draftReady && !busy.current && !ai.isPending) { if (mine) persist({ ...draft.current, flow: f, base, updated: Date.now() }); else if (draft.current) persist(null, true); }
      const k = zeplinUrls(f).join("\n");
      setEdited((e) => (e === k ? e : k));
    },
  });

  const ctl = useRef<AbortController | null>(null); // the AI run, so Dừng cancels the request
  const keep = useRef<UiFlow | null>(null); // the flow on screen when a render started: the person's edits carried over
  const [ev, setEv] = useState<FlowEvent[]>([]); // the run's stages as the server tells them (FlowProgress)
  const [started, setStarted] = useState(0);
  const [saving, setSaving] = useState(""); // what an upload is doing now (embedding images, sending)
  // a background run on the server (X-Ai-Job), its id kept per ticket: closing the dialog leaves it going, opening it
  // again reads it (`again`: that run) — still running, its result, or its error, the same as a run started here.
  // Its result saves over the file the run started from (`base`), so a save made meanwhile gets the 409, not overwritten.
  const ai = useMutation({
    mutationFn: async (again?: FlowJob) => {
      const previousJob = draft.current?.job ?? job?.id;
      const op = ++operation.current;
      ctl.current?.abort(AI_LEAVE);
      const c = (ctl.current = new AbortController());
      flowSignals.add(c.signal);
      const opts = again ? {} : runOpts.current; runOpts.current = {}; // once: the next run asks again
      const current = again ?? { id: newJobId(), base: q.data?.att ?? null, at: Date.now(), mode: opts.mode, split: opts.split, note: opts.note, skip: opts.skip };
      pendingJob.current = current;
      stopRequested.current = null;
      if ((!again || again.retryAi) && draft.current) persist({ ...draft.current, pendingJob: current.id }, true);
      aiJobs.set(c.signal, current.id);
      if (cursor.current.id !== current.id) cursor.current = { id: current.id, at: 0 };
      flowCursors.set(c.signal, (at) => { cursor.current.at = at; });
      const got: FlowEvent[] = again && cursor.current.at > 0 ? [...ev] : [];
      setEv(got); setJobError(""); setJob(null);
      setStarted(current.at / 1000); setRunMode(current.mode ?? mode);
      aiParts.set(c.signal, { text: () => {}, step: (e) => { got.push(e); if (ctl.current === c) setEv([...got]); } });
      try {
        const currentScope = await yt.flowScope();
        if (op !== operation.current || c.signal.aborted || stopRequested.current === current.id) return null;
        if (currentScope.scope !== scope) throw new Error(t("Tài khoản YouTrack đã đổi. Mở lại UI flow."));
        const result = again && !again.retryAi
          ? await yt.flowJobEvents(current.id, cursor.current.at, c.signal)
          : await yt.aiFlow(issue, current.note ?? "", current.mode ?? mode, c.signal, current.base, again ? null : keep.current, !!opts.reuse, !!current.split, current.skip ?? []);
        const state = await yt.flowJobState(current.id);
        if (op !== operation.current) return null;
        setJob(state);
        return result?.flow?.ticket === issue ? { flow: result.flow, manifest: result.manifest, base: current.base, sum: flowSummary(t, got), jobId: current.id, previousJob } : null;
      } catch (e) {
        if (op !== operation.current || c.signal.aborted) return null;
        if (!c.signal.aborted) {
          try {
            const state = await yt.flowJobState(current.id);
            setJob(state);
            if (state.result?.flow && op === operation.current) return { flow: state.result.flow, manifest: state.result.manifest, base: state.base, sum: flowSummary(t, got), jobId: state.id, previousJob };
            if (["failed", "cancelled", "interrupted"].includes(state.status) && draft.current?.pendingJob === current.id) persist({ ...draft.current, pendingJob: undefined }, true);
          } catch { setJobError(t("Chưa xác nhận trạng thái render. Kết nối lại trước khi tạo lượt mới.")); }
        }
        throw e;
      } finally { if (ctl.current === c) ctl.current = null; }

    },
    retry: false,
    onSuccess: (r) => { if (r) { if (r.previousJob && r.previousJob !== r.jobId) void yt.flowJobProcessed(r.previousJob).catch((e) => setJobError(say(e))); setMine(r); persist({ flow: r.flow, manifest: r.manifest, base: r.base, job: r.jobId, updated: Date.now() }, true); setHid(false); } },
  });
  const save = useMutation({
    mutationFn: async (f: UiFlow) => {
      busy.current = true;
      if ((await yt.flowScope()).scope !== scope) throw new Error(t("Tài khoản YouTrack đã đổi. Mở lại UI flow."));
      const op = ++operation.current;
      if (unknownSave) {
        const latest = await yt.flow(issue);
        if (latest.att !== base) throw Object.assign(new Error(t("File trên ticket đã đổi. Giữ bản nháp và xem bản mới trước khi cập nhật.")), { status: 409 });
        setUnknownSave(false);
      }
      setSaving(t("Đang nhúng ảnh Zeplin vào file…"));
      const p = await packShots(f, sq.data?.shots, (n, of) => setSaving(t("Đang nhúng ảnh Zeplin vào file {n}/{of}", { n, of }))); // the images go into the file, so it opens anywhere, offline
      setSaving(t("Đang tải file lên ticket và ghi bình luận thay đổi…"));
      if (draft.current) persist({ ...draft.current, outcomeUnknown: true }, true);
      const uploadStart = performance.now();
      const r = await yt.saveFlow(issue, f, base, p.shots);
      performance.measure("uiflow.upload", { start: uploadStart, detail: { bytes: new Blob([JSON.stringify({ flow: f, shots: p.shots })]).size } });
      const lost = p.failed ? t("{n} ảnh Zeplin chưa nhúng được vào file, màn đó vẽ khung đơn giản", { n: p.failed }) : "";
      return { ...r, op, warn: [r.warn, lost].filter(Boolean).join(". ") };
    },
    retry: false, // an upload whose outcome is unknown must never be sent again on its own
    onSuccess: (r, f) => {
      if (r.op !== operation.current) return;
      qc.setQueryData(ytFlowQuery(issue, scope).queryKey, { att: r.att, flow: { ...f, rev: r.rev }, broken: false });
      // the canvas stayed editable during the upload: what was changed meanwhile is kept, unsaved, over the new file
      const now = engine.api?.get();
      setMine(now && JSON.stringify(now) !== JSON.stringify(f) ? { flow: { ...now, rev: r.rev }, manifest: mine?.manifest, base: r.att } : null);
      setDirty(false);
      const savedJob = draft.current?.job ?? job?.id;
      persist(now && JSON.stringify(now) !== JSON.stringify(f) ? { flow: { ...now, rev: r.rev }, manifest: mine?.manifest, base: r.att, updated: Date.now() } : null, true);
      if (savedJob) void yt.flowJobProcessed(savedJob).catch((e) => setJobError(say(e)));
      setSaved(r);
      void qc.invalidateQueries({ queryKey: ["yt", "detail", issue] }); // its attachments and the new comment
      // no invalidate of the flow key: the answer above is the saved version, and a refetch would api.set over the view
    },
    onError: (e) => { const unknown = !statusOf(e) || statusOf(e) === 502; setUnknownSave(unknown); if (draft.current) persist({ ...draft.current, outcomeUnknown: unknown }, true); },
    onSettled: () => { busy.current = false; },
  });
  const reread = useRef(false); // the stored run is read once per open (not again on a refetch of the file)
  // the dialog closed: stop reading, the server's run goes on (opening the dialog again reads it)
  useEffect(() => () => { ctl.current?.abort(AI_LEAVE); ctl.current = null; }, []); // a real close unmounts: `reread` goes with it
  useEffect(() => {
    if (!q.isSuccess || q.isFetching || reread.current) return;
    reread.current = true;
    let active = true, read = false; // `read`: the draft is in (or its error shown); stopped before that: read again
    void (async () => {
      let restored = false;
      let pending: string | undefined;
      setRestoreFailed(false);
      try {
        const savedDraft = await flowDraft(scope, issue);
        if (!active) return;
        if (savedDraft) { restored = true; pending = savedDraft.pendingJob; draft.current = savedDraft; setUnknownSave(!!savedDraft.outcomeUnknown); setMine(savedDraft); setDraftStatus(t("Đã khôi phục bản nháp")); }
      } catch (e) { if (active) { read = true; setRestoreFailed(true); setDraftStatus(t("Không khôi phục được bản nháp: {msg}", { msg: say(e) })); } return; }
      if (active) { read = true; setDraftReady(true); }
      try {
        const jobs = await yt.flowJobs(issue);
        if (!active) return;
        const current = jobs.find((j) => !j.processed && j.status !== "cancelled");
        setJob(current ?? null);
        if ((!restored || pending === current?.id) && current?.result?.flow) { if (draft.current?.job && draft.current.job !== current.id) void yt.flowJobProcessed(draft.current.job).catch((e) => setJobError(say(e))); const value = { flow: current.result.flow, manifest: current.result.manifest, base: current.base, job: current.id, updated: Date.now() }; setMine(value); persist(value, true); }
        else if ((!restored || pending === current?.id) && current && ["queued", "running", "cancel_requested"].includes(current.status)) ai.mutate({ id: current.id, base: current.base, at: Date.now() });
      } catch (e) { if (active) setJobError(say(e)); }
    })();
    // stopped mid-read (StrictMode's mount → unmount → mount, a dep change): let the next run read it, or the dialog
    // would wait on draftReady for good
    return () => { active = false; if (!read) reread.current = false; };
  }, [q.isSuccess, q.isFetching, scope, restoreAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); if (scope) void flowDraft(scope, issue, draft.current).catch((e) => setDraftStatus(say(e))); } }, [scope, issue]);
  useEffect(() => {
    const flush = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; void flowDraft(scope, issue, draft.current).catch((e) => setDraftStatus(say(e))); } };
    const guard = (event: BeforeUnloadEvent) => { if (draft.current || busy.current) { flush(); event.preventDefault(); event.returnValue = ""; } };
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", guard);
    return () => { window.removeEventListener("beforeunload", guard); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", flush); };
  }, [scope, issue]);
  useEffect(() => { // what changed, shown for a moment
    if (!saved) return;
    const k = setTimeout(() => setSaved(null), CHANGES_MS);
    return () => clearTimeout(k);
  }, [saved]);

  const unsaved = !!mine || dirty;
  const locked = save.isPending || ai.isPending || !draftReady || !!jobError || !!(job && ["queued", "running", "cancel_requested"].includes(job.status));
  const renderFailed = (ai.isError && (ai.error as Error).name !== "AbortError") || job?.status === "failed";
  const headStatus: keyof typeof STATUS = ai.isPending ? "running" : job?.needs_ai_retry ? "interrupted" : renderFailed ? "failed" : unsaved ? "unsaved" : flow ? "flow" : "empty";
  // a render replaces the flow and unmounts the engine, so the edits it held are gone with it
  const start = (m: FlowMode = mode, split = false, extra = "", skip: string[] = []) => { if (busy.current || !draftReady || stopping || jobError || (job && ["queued", "running", "cancel_requested"].includes(job.status))) return; const current = engine.api?.get(); keep.current = current ?? flow; if (current && unsaved) { setMine({ flow: current, manifest: mine?.manifest, base }); persist({ flow: current, manifest: mine?.manifest, base, job: job?.id, updated: Date.now() }, true); } setSaved(null); setDirty(false); setEdited(null); save.reset(); runOpts.current = { ...runOpts.current, mode: m, split, skip, note: extra || undefined }; ai.mutate(undefined); };
  // an AI render the pre-check flags asks once first; "screens" (no AI) and a clean check just start
  const run = () => { if (mode === "flow") setRisky(true); else start(); }; // an AI render always asks first (cost, gaps, model)
  const pickMode = (m: FlowMode) => { setMode(m); put("uiflowMode", m === "flow" ? m : null); };
  // picked before the render (start panel, or the Render lại question), so the pre-check counts that platform from the start
  const [target, setTarget] = useState<FlowTarget>(() => (getPref("uiflowTarget") === "web" ? "web" : "mobile"));
  const pickTarget = (v: FlowTarget) => { setTarget(v); put("uiflowTarget", v === "web" ? v : null); };
  const stopAi = async () => {
    const id = pendingJob.current?.id ?? job?.id ?? (ctl.current && aiJobs.get(ctl.current.signal));
    if (!id || stopping) return;
    stopRequested.current = id;
    setStopping(true); setJobError("");
    try {
      const state = await yt.flowJobCancel(id); setJob(state);
      if (["cancelled", "failed", "succeeded", "interrupted"].includes(state.status)) {
        ++operation.current; ctl.current?.abort(AI_LEAVE); ai.reset(); pendingJob.current = null;
        if (!state.result?.flow && draft.current?.pendingJob === state.id) persist({ ...draft.current, pendingJob: undefined }, true);
        if (state.result?.flow) { const value = { flow: state.result.flow, manifest: state.result.manifest, base: state.base, job: state.id, updated: Date.now() }; setMine(value); persist(value, true); setHid(false); }
      }
    } catch (e) { setJobError(t("Chưa xác nhận dừng render: {msg}", { msg: say(e) })); }
    finally { setStopping(false); }
  }; // Keep the subscriber and job reference until the server acknowledges a terminal status.
  const close = () => { if (draft.current) persist(draft.current, true); setShown(false); };
  const fresh = () => { // "Xem bản mới": drop my version, read the ticket's
    if (busy.current) return;
    ++operation.current;
    const discardedJob = draft.current?.job ?? job?.id;
    persist(null, true);
    if (discardedJob) void yt.flowJobProcessed(discardedJob).catch((e) => setJobError(say(e)));
    setMine(null);
    setDirty(false);
    setEdited(null);
    save.reset();
    void qc.invalidateQueries({ queryKey: ytFlowQuery(issue, scope).queryKey });
  };

  // "Xoá UI flow": the file on the ticket (only the one seen) and any unsaved render; nothing on the ticket: the render
  const remove = useMutation({
    mutationFn: async () => { const att = q.data?.att; return att ? yt.deleteFlow(issue, att) : { warnings: [] }; },
    onSuccess: (r) => {
      setAsk(null);
      fresh();
      if (q.data?.att) qc.setQueryData(ytFlowQuery(issue, scope).queryKey, { att: null, flow: null, broken: false });
      void qc.invalidateQueries({ queryKey: ["yt", "detail", issue] }); // its attachments and the new comment
      if (r.warnings.length) setJobError(r.warnings.join(" "));
    },
  });

  // the AI run has its own view (FlowProgress); this is the file and its Zeplin images being read
  const waiting = useAiWait(!draftReady || q.isPending || (!!flow && !shotsReady));
  const conflict = statusOf(save.error) === 409 || (!!mine && mine.base !== q.data?.att);
  // the ticket's file could not be read: never the empty state, and no Render here (what it would replace is unknown)
  const readErr = q.isError && !flow;
  // an interrupted render: one warn button, under the run button (or in the footer over a flow on screen)
  const resume = job?.needs_ai_retry && !ai.isPending ? (
    <Hint side="bottom" title={t("Render bị gián đoạn")} text={t("Lượt render trước chưa xong. Bấm để gọi AI lại với đúng chế độ, model và phạm vi màn của lượt đó. Kết quả chỉ lên ticket khi bạn bấm Cập nhật.")}>
      <Button size="sm" className="border border-warn bg-warn/15 text-warn hover:bg-warn/25" disabled={save.isPending} onClick={() => { if (!job) return; ai.mutate({ id: newJobId(), base: job.base, at: Date.now(), retryAi: true, note: job.request?.note ?? "", mode: job.request?.mode ?? mode, split: job.request?.split, skip: job.request?.skip ?? [] }); }}>
        <RotateCw aria-hidden />{t("Tiếp tục render")}
      </Button>
    </Hint>
  ) : null;
  // the empty flow counts what a render would read (no AI; the warning dialog opens on the same cached count)
  const starting = !readErr && !ai.isPending && !waiting && !flow && !q.data?.broken;
  // two counts: every screen (the sizes, for the platform picker), then without the other platform's (what is sent);
  // the second is also the warning dialog's own key, so it opens on it at once
  const startAll = useFlowCheck(issue, starting, []);
  const startSkip = platformSkip(startAll.data, target);
  const startSent = useFlowCheck(issue, starting && !!startAll.data, startSkip);
  const startCheck = { data: startSent.data ?? startAll.data, error: startSent.error ?? startAll.error };
  // a render that failed: one card, by the run button (start panel) or in the footer (a flow, a run, an error view); the AI's
  // own error first, else the job's (a reopened dialog only has the job). Gone once the next run starts.
  const failMsg = ai.isPending ? ""
    : ai.isError && (ai.error as Error).name !== "AbortError" ? (flowStage(t, ev) ? t("Không render được (bước “{stage}”): {msg}", { stage: flowStage(t, ev), msg: say(ai.error) }) : t("Không render được: {msg}", { msg: say(ai.error) }))
    : job?.status === "failed" ? t("Không render được: {msg}", { msg: String((job.error as { detail?: string; code?: string } | null)?.detail ?? (job.error as { code?: string } | null)?.code ?? job.status) })
    : "";
  const failed = failMsg ? (
    <div role="alert" className="flex w-full max-w-2xl items-start gap-3 rounded-xl border border-error/40 bg-error/10 px-4 py-3 text-left">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
      <div className="grid min-w-0 gap-0.5">
        <p className="text-sm font-medium text-ink">{t("Lượt render trước không thành công")}</p>
        <p className="text-xs break-words text-ink-2">{failMsg}</p>
        <p className="text-xs text-ink-3">{t("Bấm render để thử lại. Nếu vẫn lỗi: chọn “Chia phần” (ticket nhiều màn) hoặc model / effort mạnh hơn trong hộp cảnh báo.")}</p>
        {ai.isError && job && !job.needs_ai_retry && <div className="pt-1.5"><Button size="sm" variant="outline" onClick={() => ai.mutate({ id: job.id, base: job.base, at: Date.now() })}>{t("Kết nối lại")}</Button></div>}
      </div>
    </div>
  ) : null;
  // a run whose state could not be confirmed (connection lost): same card place, with its own reconnect
  const lost = jobError ? (
    <div role="alert" className="flex w-full max-w-2xl flex-wrap items-start gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-left">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <p className="min-w-0 flex-1 text-sm break-words text-ink">{jobError}</p>
      <Button size="sm" variant="outline" onClick={() => { setJobError(""); void (pendingJob.current ? yt.flowJobState(pendingJob.current.id) : yt.flowJobs(issue).then((jobs) => jobs.find((j) => !j.processed))).then((current) => { setJob(current ?? null); if (current && ["queued", "running", "cancel_requested", "succeeded"].includes(current.status)) ai.mutate({ id: current.id, base: current.base, at: Date.now() }); }, (e) => setJobError(say(e))); }}>{t("Kết nối lại")}</Button>
    </div>
  ) : null;
  const body = readErr ? <Center>
      <p role="alert" className="max-w-sm text-sm text-error">{t("Không đọc được UI flow của ticket: {msg}", { msg: say(q.error) })}</p>
      <Button size="sm" variant="outline" onClick={() => { void q.refetch(); }}><RotateCw aria-hidden />{t("Thử lại")}</Button>
    </Center>
    : ai.isPending ? <FlowProgress events={ev} started={started} mode={runMode} />
    : engine.error ? <Center><p role="alert" className="text-sm text-error">{say(engine.error)}</p><Button size="sm" variant="outline" onClick={engine.retry}><RotateCw aria-hidden />{t("Thử lại")}</Button></Center>
    : waiting ? <YtFetching kind="flow" />
    : flow ? <div ref={setEl} className="h-full" />
    : q.data?.broken ? <Center>
        <p className="max-w-sm text-sm text-ink-2">{t("File UI flow trên ticket không đọc được")}</p>
        <Button size="sm" className="rounded-full bg-hl text-hl-ink hover:brightness-110" onClick={run}><Sparkles aria-hidden />{t("Render lại bằng AI")}</Button>
      </Center>
    : <FlowStart mode={mode} onPick={pickMode} onRun={() => (mode === "screens" ? start("screens", false, "", startSkip) : run())} resume={resume} notice={<>{failed}{lost}</>} target={target} onTarget={pickTarget} check={startCheck.data} checkError={startCheck.error} />;

  return (
    <>
      {/* only X closes it: Esc is the engine's (drop the selection, stop a draw, close a form), a stray click is nothing */}
      {/* (cancel, not just ignore: base-ui would still run its close for a press in a ConfirmDialog over this one) */}
      <Dialog open={open && shown} onOpenChange={(_, d) => d.cancel()} onOpenChangeComplete={(o) => { if (!o) onClose(); }}>
        <DialogContent showCloseButton={false} className={cn(DIALOG_SHEET, "left-0 w-full sm:max-w-none")}>
          <header className="flex shrink-0 items-center gap-3 border-b border-rule bg-paper-2 px-3 py-2.5">
            <Hint side="bottom" text={t("Đóng UI flow. Sơ đồ chưa cập nhật được giữ làm bản nháp.")}>
              <Button data-autofocus size="icon-sm" variant="ghost" aria-label={t("Đóng")} onClick={close}><ArrowLeft /></Button>
            </Hint>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hl-wash text-hl-2"><Workflow className="size-4" aria-hidden /></span>
            <div className="flex min-w-0 flex-1 flex-col">
              <DialogTitle className="truncate pr-0 text-sm font-bold text-ink">{t("UI flow {id}", { id: issue })}</DialogTitle>
              <p className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
                <span className={cn("shrink-0 rounded-full px-2 py-px text-2xs font-bold", STATUS[headStatus].tone)}>{t(STATUS[headStatus].label)}</span>
                <span className="truncate">{t(STATUS[headStatus].hint)}</span>
              </p>
            </div>
            {flow && ( // no render yet: the start panel has the run button, nothing to redo
              <Hint side="bottom" title={t("Render lại bằng AI")} text={t("Đọc lại ticket và vẽ lại sơ đồ; giữ ghi chú, vùng bấm vẽ tay và màn bắt đầu. Có thể chọn chỉ vẽ phần mới để ít token. Hỏi lại trước khi chạy; file trên ticket chỉ đổi khi bấm Cập nhật.")}>
                <Button size="icon-sm" variant="ghost" aria-label={t("Render lại bằng AI")} disabled={locked} onClick={() => setAsk("again")}><RefreshCw /></Button>
              </Hint>
            )}
            {q.data?.att && (
              <Hint side="bottom" text={t("Tải file HTML của UI flow trên ticket: mở được offline, không cần app")}>
                <Button size="icon-sm" variant="ghost" aria-label={t("Tải file HTML")} nativeButton={false}
                  render={<a href={fileUrl(issue, { id: q.data.att })} target="_blank" rel="noopener noreferrer" />}><Download /></Button>
              </Hint>
            )}
            {flow && (
              <Hint side="bottom" text={q.data?.att ? t("Xoá UI flow: gỡ file trên ticket (có hỏi lại trước)") : t("Bỏ bản render: bỏ sơ đồ AI vừa vẽ, chưa lên ticket (có hỏi lại trước)")}>
                <Button size="icon-sm" variant="ghost" className="hover:text-error" aria-label={q.data?.att ? t("Xoá UI flow") : t("Bỏ bản render")} disabled={locked} onClick={() => { remove.reset(); setAsk("delete"); }}><Trash2 /></Button>
              </Hint>
            )}
          </header>
          <div className="relative min-h-0 flex-1">{body}</div>
          <footer className="shrink-0 border-t border-rule bg-paper-2 p-3 empty:hidden">
            {readErr ? null : unsaved && !hid && !waiting && !ai.isPending && engine.api ? (
              <div className="flex flex-wrap items-center gap-2">
                <p role="status" className="min-w-0 flex-1 text-sm text-ink">
                  {save.isPending && saving ? <span className="ai-text">{saving}</span>
                    : mine?.sum?.text && !dirty ? <>
                        {t("{s} — chưa lưu, cập nhật file trên ticket?", { s: mine.sum.text })}
                        {mine.sum.warn && <span role="alert" className="mt-0.5 block text-xs text-warn">{mine.sum.warn}</span>}
                      </>
                    : t("Có thay đổi chưa lưu — cập nhật file trên ticket?")}
                </p>
                <Button size="sm" variant="outline" aria-busy={diff.isPending} disabled={save.isPending || diff.isPending} onClick={() => engine.api && diff.mutate(engine.api.get())}>{t("Xem thay đổi")}</Button>
                <Button size="sm" aria-busy={save.isPending} disabled={save.isPending || conflict} onClick={() => { diff.reset(); if (engine.api) save.mutate(engine.api.get()); }}>{t("Cập nhật")}</Button>
                <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => setHid(true)}>{t("Không")}</Button>
              </div>
            ) : flow && !ai.isPending ? (
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                {t("Kéo thả để sửa; mọi thay đổi chỉ lên ticket khi bạn bấm Cập nhật.")}
                {unsaved && hid && <Button size="xs" variant="outline" onClick={() => setHid(false)}>{t("Cập nhật lên ticket")}</Button>}
              </p>
            ) : ai.isPending ? (
              <div className="flex items-center justify-end gap-3">
                <Hint side="bottom" text={t("Dừng lượt AI đang chạy. Nếu đã có kết quả, sơ đồ đó được giữ làm bản nháp.")}>
                  <Button size="sm" variant="outline" disabled={stopping} onClick={stopAi}>{t("Dừng render")}</Button>
                </Hint>
              </div>
            ) : null}
            {unsaved && diff.data && (
              <div className="mt-2 grid gap-1 text-xs text-ink-2">
                <p className="font-medium text-ink">{diff.data.changes.length ? t("Cập nhật sẽ ghi {n} thay đổi:", { n: diff.data.changes.length }) : t("Không có thay đổi so với file trên ticket.")}</p>
                {diff.data.changes.slice(0, 20).map((c) => <p key={c} className="truncate">{c}</p>)}
                {diff.data.changes.length > 20 && <p>{t("… và {n} thay đổi khác", { n: diff.data.changes.length - 20 })}</p>}
                {diff.data.base_changed && <p role="alert" className="text-warn">{t("File trên ticket đã đổi từ khi mở: so với bản mới nhất.")}</p>}
              </div>
            )}
            {diff.isError && <p role="alert" className="mt-2 text-xs text-error">{t("Không xem được thay đổi: {msg}", { msg: say(diff.error) })}</p>}
            {redesigned.length > 0 && !mine && !dirty && !ai.isPending && engine.api && (
              <div role="status" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warn">
                <span className="min-w-0 flex-1">
                  {t("Thiết kế Zeplin của {n} màn đã đổi từ lần cập nhật: {s}. Bấm Cập nhật để nhúng ảnh mới vào file; màn / nút mới: ↻ Render lại bằng AI (Chỉ vẽ phần mới). Nút không còn khớp chữ hiện trong mục kiểm tra của sơ đồ.", { n: redesigned.length, s: redesigned.slice(0, 5).map((s) => s.title).join(", ") + (redesigned.length > 5 ? "…" : "") })}
                </span>
                <Button size="xs" variant="outline" aria-busy={save.isPending} disabled={save.isPending || conflict} onClick={() => { if (engine.api) save.mutate(engine.api.get()); }}>{t("Cập nhật")}</Button>
              </div>
            )}
            {q.data?.ticket_newer && flow && !mine && !ai.isPending && <p className="mt-2 text-xs text-ink-3">{t("Ticket đã sửa sau lần cập nhật UI flow. Muốn lấy thay đổi: ↻ Render lại bằng AI (giữ ghi chú, vùng bấm vẽ tay, màn bắt đầu).")}</p>}
            {mine?.manifest?.kept && Object.values(mine.manifest.kept).some(Boolean) && <p className="mt-2 text-xs text-ink-3">{t("Giữ từ sơ đồ trước: {p} vị trí màn, {n} ghi chú, {r} vùng bấm", { p: mine.manifest.kept.positions ?? 0, n: mine.manifest.kept.notes ?? 0, r: mine.manifest.kept.rects ?? 0 })}</p>}
            {(unsaved || draftStatus) && <p role="status" className="mt-2 text-xs text-ink-3">{draftStatus}{draftStatus.includes(":") && <Button size="xs" variant="ghost" onClick={() => { if (restoreFailed) { reread.current = false; setRestoreAttempt((n) => n + 1); } else persist(draft.current, true); }}>{t("Thử lại")}</Button>}{unsaved && <Button size="xs" variant="ghost" disabled={save.isPending || ai.isPending} onClick={() => setAsk("fresh")}>{t("Bỏ bản nháp")}</Button>}</p>}
            {conflict && <p role="alert" className="mt-2 text-xs text-warn">{t("File trên ticket đã đổi. Bản nháp được giữ lại.")}<Button size="xs" variant="outline" disabled={save.isPending} onClick={() => setAsk("fresh")}>{t("Xem bản mới")}</Button></p>}
            {unknownSave && <p role="alert" className="mt-2 text-xs text-warn">{t("Chưa rõ kết quả cập nhật. Lần cập nhật tiếp theo sẽ kiểm tra lại file trên ticket.")}</p>}
            {stopping && <p role="status">{t("Đang yêu cầu dừng…")}</p>}
            {lost && !starting && <div className="mt-2">{lost}</div>} {/* the start panel shows them itself */}
            {resume && flow && <div className="mt-2 flex justify-end">{resume}</div>}
            {mine?.manifest && <details open={!!mine.manifest.warnings?.length} className="mt-2 text-xs text-ink-3"><summary>{t("Nguồn dựng sơ đồ")}</summary><p>{t("Đầu vào ước lượng: {n} token, gửi đủ 100% nguồn", { n: mine.manifest.estimated_input_tokens })}</p><p>{mine.manifest.sources.join(", ")}</p>{mine.manifest.omitted.length > 0 && <p>{t("Đã lược bỏ {n} mục phụ; giữ yêu cầu bắt buộc.", { n: mine.manifest.omitted.reduce((n, item) => n + item.count, 0) })}</p>}{mine.manifest.warnings?.map((warning, i) => <p role="alert" key={i} className="text-warn">{warning}</p>)}</details>}
            {sq.isError && flow && <p role="alert" className="mt-2 text-xs text-warn">{t("Không lấy được ảnh Zeplin: {msg}", { msg: say(sq.error) })}</p>}
            {!!sq.data?.missing.length && flow && <p className="mt-2 text-xs text-ink-3">{t("{n} màn Zeplin không đọc được (chưa chia sẻ với tài khoản này hoặc đã xoá)", { n: sq.data.missing.length })}</p>}
            {failed && !starting && <div className="mt-2">{failed}</div>}
            {save.isError && (
              <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-error">
                {say(save.error)}
              </p>
            )}
            {saved && (
              <div className="mt-2 grid gap-1 text-xs text-ink-2 animate-in fade-in-0">
                <p className="font-medium text-ok">{t("Đã cập nhật file trên ticket (rev {n})", { n: saved.rev })}</p>
                {saved.changes.slice(0, 6).map((c) => <p key={c} className="truncate">{c}</p>)}
                {saved.warn && <p role="alert" className="text-warn">{saved.warn}</p>}
              </div>
            )}
          </footer>
        </DialogContent>
      </Dialog>
      {risky && <FlowRisks issue={issue} target={target} open={risky} onOpenChange={setRisky} onRun={(extra, skip) => start("flow", false, extra, skip)} onScreens={(skip) => { pickMode("screens"); start("screens", false, "", skip); }} onSplit={(extra, skip) => start("flow", true, extra, skip)} />}
      {/* after a 409: the ticket's version replaces mine, and mine cannot be read back */}
      <ConfirmDialog open={ask === "fresh"} onOpenChange={(o) => !o && setAsk(null)} title={t("Bỏ thay đổi chưa lưu?")}
        description={t("Xem bản mới trên ticket sẽ mất các thay đổi chưa lưu của bạn.")} confirmLabel={t("Xem bản mới")}
        onConfirm={() => { setAsk(null); fresh(); }} />
      <ConfirmDialog open={ask === "delete"} onOpenChange={(o) => !o && setAsk(null)} busy={remove.isPending}
        title={q.data?.att ? t("Xoá UI flow trên ticket?") : t("Bỏ bản render chưa lưu?")}
        description={q.data?.att
          ? t("Xoá file {name} khỏi ticket {id} và ghi một bình luận; không hoàn tác được. Thay đổi chưa lưu cũng mất.", { name: `uiflow-${issue}.html`, id: issue })
          : t("Sơ đồ đang xem chưa lên ticket sẽ mất; không hoàn tác được.")}
        error={remove.isError ? say(remove.error) : undefined}
        confirmLabel={q.data?.att ? t("Xóa") : t("Bỏ bản render")} onConfirm={() => remove.mutate()} />
      {/* a render replaces the flow on screen, so say so — and name the loss when something is unsaved */}
      <ConfirmDialog open={ask === "again"} onOpenChange={(o) => !o && setAsk(null)} tone="default" icon={Sparkles}
        title={t("Render lại bằng AI?")}
        description={unsaved
          ? t("AI dựng lại sơ đồ từ ticket, thay sơ đồ đang xem; ghi chú, vùng bấm vẽ tay và màn bắt đầu của các màn khớp được giữ, sửa khác chưa lưu sẽ mất.")
          : t("AI dựng lại sơ đồ từ ticket, thay sơ đồ đang xem; ghi chú, vùng bấm vẽ tay và màn bắt đầu của các màn khớp được giữ. File trên ticket chỉ đổi khi bạn bấm Cập nhật.")}
        confirmLabel={t("Render lại")} onConfirm={() => { setAsk(null); runOpts.current = { reuse }; setRisky(true); }}>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-1 accent-hl" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
          <span>{t("Chỉ vẽ phần mới")}<span className="block text-xs text-ink-3">{t("Giữ liên kết đang có, AI chỉ bổ sung màn / liên kết mới: ít token hơn nhiều. Bỏ chọn để AI vẽ lại toàn bộ.")}</span></span>
        </label>
        <FlowTargetPicker id="uiflow-target-again" value={target} onChange={pickTarget} />
      </ConfirmDialog>
    </>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <div className="grid h-full w-full place-content-center justify-items-center gap-3 p-6 text-center">{children}</div>
);
