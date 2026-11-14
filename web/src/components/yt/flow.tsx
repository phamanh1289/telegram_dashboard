"use client";

import { Menu } from "@base-ui/react/menu";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Ellipsis, RotateCw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiBot, AiPromptBox } from "@/components/ai/chat";
import { useAiWait } from "@/components/ai/fetching";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogTitle, DIALOG_SHEET } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { MENU_ACTION, MENU_ITEM, MENU_POPUP } from "@/components/ui/menu";
import { useLang, useT } from "@/lib/i18n";
import { getPref, put } from "@/lib/prefs";
import { packShots, useUiFlow, zeplinUrls } from "@/lib/uiflow";
import { AI_LEAVE, aiJobs, aiParts, fileUrl, flowSignals, flowCursors, type FlowJob, type FlowJobState, type FlowSaved, type FlowManifest, newJobId, type UiFlow, yt, ytFlowQuery } from "@/lib/yt";
import { flowDraft, type FlowDraft } from "@/lib/flow-draft";
import { cn } from "@/lib/utils";
import { YtFetching, YtPicks } from "./bits";
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
  const [ask, setAsk] = useState<"again" | "fresh" | null>(null);
  const [note, setNote] = useState("");
  // "Nhanh": the light YouTrack picks (Hỏi AI…), enough once the Zeplin texts come with the ticket; "Kỹ": the heavy
  // picks, for a long or tangled story. Remembered per browser.
  const [deep, setDeep] = useState(() => getPref("uiflowDeep") === "1");
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
      const current = again ?? { id: newJobId(), base: q.data?.att ?? null, at: Date.now() };
      pendingJob.current = current;
      stopRequested.current = null;
      if ((!again || again.retryAi) && draft.current) persist({ ...draft.current, pendingJob: current.id }, true);
      aiJobs.set(c.signal, current.id);
      if (cursor.current.id !== current.id) cursor.current = { id: current.id, at: 0 };
      flowCursors.set(c.signal, (at) => { cursor.current.at = at; });
      const got: FlowEvent[] = again && cursor.current.at > 0 ? [...ev] : [];
      setEv(got); setJobError(""); setJob(null);
      setStarted(current.at / 1000);
      aiParts.set(c.signal, { text: () => {}, step: (e) => { got.push(e); if (ctl.current === c) setEv([...got]); } });
      try {
        const currentScope = await yt.flowScope();
        if (op !== operation.current || c.signal.aborted || stopRequested.current === current.id) return null;
        if (currentScope.scope !== scope) throw new Error(t("Tài khoản YouTrack đã đổi. Mở lại UI flow."));
        const result = again && !again.retryAi
          ? await yt.flowJobEvents(current.id, cursor.current.at, c.signal)
          : await yt.aiFlow(issue, current.note ?? note.trim(), current.deep ?? deep, c.signal, current.base, again ? null : keep.current);
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
    onSuccess: (r) => { if (r) { if (r.previousJob && r.previousJob !== r.jobId) void yt.flowJobProcessed(r.previousJob).catch((e) => setJobError(say(e))); setMine(r); persist({ flow: r.flow, manifest: r.manifest, base: r.base, job: r.jobId, updated: Date.now() }, true); setHid(false); setNote(""); } },
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
    let active = true;
    void (async () => {
      let restored = false;
      let pending: string | undefined;
      setRestoreFailed(false);
      try {
        const savedDraft = await flowDraft(scope, issue);
        if (!active) return;
        if (savedDraft) { restored = true; pending = savedDraft.pendingJob; draft.current = savedDraft; setUnknownSave(!!savedDraft.outcomeUnknown); setMine(savedDraft); setDraftStatus(t("Đã khôi phục bản nháp")); }
      } catch (e) { if (active) { setRestoreFailed(true); setDraftStatus(t("Không khôi phục được bản nháp: {msg}", { msg: say(e) })); } return; }
      if (active) setDraftReady(true);
      try {
        const jobs = await yt.flowJobs(issue);
        if (!active) return;
        const current = jobs.find((j) => !j.processed && j.status !== "cancelled");
        setJob(current ?? null);
        if ((!restored || pending === current?.id) && current?.result?.flow) { if (draft.current?.job && draft.current.job !== current.id) void yt.flowJobProcessed(draft.current.job).catch((e) => setJobError(say(e))); const value = { flow: current.result.flow, manifest: current.result.manifest, base: current.base, job: current.id, updated: Date.now() }; setMine(value); persist(value, true); }
        else if ((!restored || pending === current?.id) && current && ["queued", "running", "cancel_requested"].includes(current.status)) ai.mutate({ id: current.id, base: current.base, at: Date.now() });
      } catch (e) { if (active) setJobError(say(e)); }
    })();
    return () => { active = false; };
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
  // a render replaces the flow and unmounts the engine, so the edits it held are gone with it
  const run = () => { if (busy.current || !draftReady || stopping || jobError || (job && ["queued", "running", "cancel_requested"].includes(job.status))) return; const current = engine.api?.get(); keep.current = current ?? flow; if (current && unsaved) { setMine({ flow: current, manifest: mine?.manifest, base }); persist({ flow: current, manifest: mine?.manifest, base, job: job?.id, updated: Date.now() }, true); } setSaved(null); setDirty(false); setEdited(null); save.reset(); ai.mutate(undefined); };
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

  // the AI run has its own view (FlowProgress); this is the file and its Zeplin images being read
  const waiting = useAiWait(!draftReady || q.isPending || (!!flow && !shotsReady));
  const conflict = statusOf(save.error) === 409 || (!!mine && mine.base !== q.data?.att);
  // the ticket's file could not be read: never the empty state, and no Render here (what it would replace is unknown)
  const readErr = q.isError && !flow;
  const body = readErr ? <Center>
      <p role="alert" className="max-w-sm text-sm text-error">{t("Không đọc được UI flow của ticket: {msg}", { msg: say(q.error) })}</p>
      <Button size="sm" variant="outline" onClick={() => { void q.refetch(); }}><RotateCw aria-hidden />{t("Thử lại")}</Button>
    </Center>
    : ai.isPending ? <FlowProgress events={ev} started={started} deep={deep} />
    : engine.error ? <Center><p role="alert" className="text-sm text-error">{say(engine.error)}</p><Button size="sm" variant="outline" onClick={engine.retry}><RotateCw aria-hidden />{t("Thử lại")}</Button></Center>
    : waiting ? <YtFetching kind="flow" />
    : flow ? <div ref={setEl} className="h-full" />
    : q.data?.broken ? <Center>
        <p className="max-w-sm text-sm text-ink-2">{t("File UI flow trên ticket không đọc được")}</p>
        <Button size="sm" className="rounded-full bg-hl text-hl-ink hover:brightness-110" onClick={run}><Sparkles aria-hidden />{t("Render lại bằng AI")}</Button>
      </Center>
    : <Empty className="h-full content-center" art={<AiBot className="ai-float size-16 drop-shadow-lg" />} title={t("Ticket này chưa có UI flow")} />;

  return (
    <>
      <Dialog open={open && shown} onOpenChange={(o) => { if (!o) close(); }} onOpenChangeComplete={(o) => { if (!o) onClose(); }}>
        <DialogContent showCloseButton={false} className={cn(DIALOG_SHEET, "left-0 w-full sm:max-w-none")}>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-rule bg-paper-2 px-4">
            <DialogTitle className="truncate pr-0 text-sm">{t("UI flow {id}", { id: issue })}</DialogTitle>
            <FlowMenu issue={issue} att={q.data?.att ?? null} disabled={save.isPending || ai.isPending || !draftReady || !!jobError || !!(job && ["queued", "running", "cancel_requested"].includes(job.status))} onAgain={() => (flow ? setAsk("again") : run())} className="ml-auto" />
            <Button data-autofocus size="icon-sm" variant="ghost" aria-label={t("Đóng")} onClick={close}><X /></Button>
          </header>
          <div className="relative min-h-0 flex-1">{body}</div>
          <footer className="shrink-0 border-t border-rule bg-paper-2 p-3">
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
            ) : ( // a run, even over a flow already on screen, keeps the box: its ring and Dừng are the run's controls
              <AiPromptBox aria-label={t("Ghi chú thêm cho AI")} placeholder={t("Ghi chú thêm cho AI (không bắt buộc)")} maxLength={2000}
                value={note} onChange={setNote} onSend={run} running={ai.isPending} onStop={stopAi} stopHint={t("Dừng render")}
                tools={!ai.isPending && <>
                  <Segmented id="uiflow-depth" label={t("Cách render")} value={deep ? "deep" : "fast"}
                    onChange={(v) => { setDeep(v === "deep"); put("uiflowDeep", v === "deep" ? "1" : null); }}
                    items={[
                      { value: "fast", label: t("Nhanh"), title: t("Model nhẹ: nhanh, ít token. Đủ cho hầu hết ticket có AC và màn Zeplin rõ.") },
                      { value: "deep", label: t("Kỹ"), title: t("Model mạnh: chậm và tốn token hơn. Dùng khi story dài, nhiều nhánh hoặc bản Nhanh thiếu màn.") },
                    ]} />
                  <YtPicks heavy={deep} />
                </>}
                actions={!ai.isPending && (
                  <Hint side="bottom" text={t("AI đọc ticket rồi dựng sơ đồ màn hình và luồng bấm (Enter)")}>
                    <Button type="button" size="sm" className="rounded-full bg-hl text-hl-ink hover:brightness-110" onClick={run}>
                      <Sparkles aria-hidden />{t("Render bằng AI")}
                    </Button>
                  </Hint>
                )} />
            )}
            {unsaved && diff.data && (
              <div className="mt-2 grid gap-1 text-xs text-ink-2">
                <p className="font-medium text-ink">{diff.data.changes.length ? t("Cập nhật sẽ ghi {n} thay đổi:", { n: diff.data.changes.length }) : t("Không có thay đổi so với file trên ticket.")}</p>
                {diff.data.changes.slice(0, 20).map((c) => <p key={c} className="truncate">{c}</p>)}
                {diff.data.changes.length > 20 && <p>{t("… và {n} thay đổi khác", { n: diff.data.changes.length - 20 })}</p>}
                {diff.data.base_changed && <p role="alert" className="text-warn">{t("File trên ticket đã đổi từ khi mở: so với bản mới nhất.")}</p>}
              </div>
            )}
            {diff.isError && <p role="alert" className="mt-2 text-xs text-error">{t("Không xem được thay đổi: {msg}", { msg: say(diff.error) })}</p>}
            {q.data?.ticket_newer && flow && !mine && !ai.isPending && <p className="mt-2 text-xs text-ink-3">{t("Ticket đã sửa sau lần cập nhật UI flow. Muốn lấy thay đổi: ⋯ › Render lại bằng AI (giữ ghi chú, vùng bấm vẽ tay, màn bắt đầu).")}</p>}
            {mine?.manifest?.kept && Object.values(mine.manifest.kept).some(Boolean) && <p className="mt-2 text-xs text-ink-3">{t("Giữ từ sơ đồ trước: {p} vị trí màn, {n} ghi chú, {r} vùng bấm", { p: mine.manifest.kept.positions ?? 0, n: mine.manifest.kept.notes ?? 0, r: mine.manifest.kept.rects ?? 0 })}</p>}
            {(unsaved || draftStatus) && <p role="status" className="mt-2 text-xs text-ink-3">{draftStatus}{draftStatus.includes(":") && <Button size="xs" variant="ghost" onClick={() => { if (restoreFailed) { reread.current = false; setRestoreAttempt((n) => n + 1); } else persist(draft.current, true); }}>{t("Thử lại")}</Button>}{unsaved && <Button size="xs" variant="ghost" disabled={save.isPending || ai.isPending} onClick={() => setAsk("fresh")}>{t("Bỏ bản nháp")}</Button>}</p>}
            {conflict && <p role="alert" className="mt-2 text-xs text-warn">{t("File trên ticket đã đổi. Bản nháp được giữ lại.")}<Button size="xs" variant="outline" disabled={save.isPending} onClick={() => setAsk("fresh")}>{t("Xem bản mới")}</Button></p>}
            {unknownSave && <p role="alert" className="mt-2 text-xs text-warn">{t("Chưa rõ kết quả cập nhật. Lần cập nhật tiếp theo sẽ kiểm tra lại file trên ticket.")}</p>}
            {job?.status === "failed" && <p role="alert" className="mt-2 text-sm text-error">{t("Không render được: {msg}", { msg: String((job.error as { detail?: string; code?: string } | null)?.detail ?? (job.error as { code?: string } | null)?.code ?? job.status) })}</p>}
            {stopping && <p role="status">{t("Đang yêu cầu dừng…")}</p>}
            {jobError && <p role="alert" className="text-error">{jobError}<Button size="xs" onClick={() => { setJobError(""); void (pendingJob.current ? yt.flowJobState(pendingJob.current.id) : yt.flowJobs(issue).then((jobs) => jobs.find((j) => !j.processed))).then((current) => { setJob(current ?? null); if (current && ["queued", "running", "cancel_requested", "succeeded"].includes(current.status)) ai.mutate({ id: current.id, base: current.base, at: Date.now() }); }, (e) => setJobError(say(e))); }}>{t("Kết nối lại")}</Button></p>}
            {job?.needs_ai_retry && !ai.isPending && <><p className="text-xs text-warn">{t("Render bị gián đoạn. Tiếp tục sẽ gọi AI lại.")}</p><Button size="sm" disabled={save.isPending} onClick={() => { if (!job) return; ai.mutate({ id: newJobId(), base: job.base, at: Date.now(), retryAi: true, note: job.request?.note ?? note, deep: job.request?.deep ?? deep }); }}>{t("Tiếp tục")}</Button></>}
            {ai.isError && job && !job.needs_ai_retry && <Button size="sm" onClick={() => ai.mutate({ id: job.id, base: job.base, at: Date.now() })}>{t("Kết nối lại")}</Button>}
            {mine?.manifest && <details open={!!mine.manifest.warnings?.length} className="mt-2 text-xs text-ink-3"><summary>{t("Nguồn dựng sơ đồ")}</summary><p>{t("Đầu vào ước lượng: {n}/{budget} token", { n: mine.manifest.estimated_input_tokens, budget: mine.manifest.budget })}</p><p>{mine.manifest.sources.join(", ")}</p>{mine.manifest.omitted.length > 0 && <p>{t("Đã lược bỏ {n} mục phụ; giữ yêu cầu bắt buộc.", { n: mine.manifest.omitted.reduce((n, item) => n + item.count, 0) })}</p>}{mine.manifest.warnings?.map((warning, i) => <p role="alert" key={i} className="text-warn">{warning}</p>)}</details>}
            {sq.isError && flow && <p role="alert" className="mt-2 text-xs text-warn">{t("Không lấy được ảnh Zeplin: {msg}", { msg: say(sq.error) })}</p>}
            {!!sq.data?.missing.length && flow && <p className="mt-2 text-xs text-ink-3">{t("{n} màn Zeplin không đọc được (chưa chia sẻ với tài khoản này hoặc đã xoá)", { n: sq.data.missing.length })}</p>}
            {ai.isError && (ai.error as Error).name !== "AbortError" && <p role="alert" className="mt-2 text-sm text-error">
              {flowStage(t, ev) ? t("Không render được (bước “{stage}”): {msg}", { stage: flowStage(t, ev), msg: say(ai.error) }) : t("Không render được: {msg}", { msg: say(ai.error) })}
            </p>}
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
      {/* after a 409: the ticket's version replaces mine, and mine cannot be read back */}
      <ConfirmDialog open={ask === "fresh"} onOpenChange={(o) => !o && setAsk(null)} title={t("Bỏ thay đổi chưa lưu?")}
        description={t("Xem bản mới trên ticket sẽ mất các thay đổi chưa lưu của bạn.")} confirmLabel={t("Xem bản mới")}
        onConfirm={() => { setAsk(null); fresh(); }} />
      {/* a render replaces the flow on screen, so say so — and name the loss when something is unsaved */}
      <ConfirmDialog open={ask === "again"} onOpenChange={(o) => !o && setAsk(null)} tone="default" icon={Sparkles}
        title={t("Render lại bằng AI?")}
        description={unsaved
          ? t("AI dựng lại sơ đồ từ ticket, thay sơ đồ đang xem; ghi chú, vùng bấm vẽ tay và màn bắt đầu của các màn khớp được giữ, sửa khác chưa lưu sẽ mất.")
          : t("AI dựng lại sơ đồ từ ticket, thay sơ đồ đang xem; ghi chú, vùng bấm vẽ tay và màn bắt đầu của các màn khớp được giữ. File trên ticket chỉ đổi khi bạn bấm Cập nhật.")}
        confirmLabel={t("Render lại")} onConfirm={() => { setAsk(null); run(); }} />
    </>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <div className="grid h-full w-full place-content-center justify-items-center gap-3 p-6 text-center">{children}</div>
);

/** The dialog's "⋯": render the flow again, or download the file the ticket holds. */
function FlowMenu({ issue, att, onAgain, className, disabled }: { issue: string; att: string | null; onAgain: () => void; className?: string; disabled?: boolean }) {
  const t = useT();
  return (
    <Menu.Root>
      <Hint side="bottom" text={t("Thao tác với UI flow của ticket này")}>
        <Menu.Trigger aria-label={t("Thao tác UI flow")} className={className} render={<Button size="icon-sm" variant="ghost" className="data-popup-open:bg-paper-3" />}>
          <Ellipsis />
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          <Menu.Popup className={cn(MENU_POPUP, "w-64 text-sm")}>
            <Menu.Item disabled={disabled} onClick={onAgain} className={cn(MENU_ITEM, MENU_ACTION)}><Sparkles aria-hidden />{t("Render lại bằng AI")}</Menu.Item>
            {att && (
              <Menu.Item className={cn(MENU_ITEM, MENU_ACTION, "no-underline")}
                render={<a href={fileUrl(issue, { id: att })} target="_blank" rel="noopener noreferrer" />}>
                <Download aria-hidden />{t("Tải file HTML")}
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
