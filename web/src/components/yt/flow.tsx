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
import { AI_LEAVE, aiJobs, fileUrl, flowJob, type FlowJob, type FlowSaved, newJobId, setFlowJob, type UiFlow, yt, ytFlowQuery } from "@/lib/yt";
import { cn } from "@/lib/utils";
import { YtFetching, YtPicks } from "./bits";

// The ticket's UI flow: the file on the ticket drawn by the engine (web/public/uiflow.js), one AI run to build it, and
// the bar that uploads what changed back. The dialog orchestrates; the calls live in lib/yt, the engine in lib/uiflow.

/** The server's own words for a failed call (ytApi already translated the codes it knows); `status` for the 409. */
const say = (e: unknown) => (e as Error).message;
const statusOf = (e: unknown) => (e as { status?: number } | null | undefined)?.status;
const CHANGES_MS = 4000;

export function FlowDialog({ issue, open, onClose }: { issue: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  // the flow being shown over the ticket's own: an AI result, not saved yet (`base`: the file it would replace)
  const [mine, setMine] = useState<{ flow: UiFlow; base: string | null } | null>(null);
  const [dirty, setDirty] = useState(false); // the engine's edits since it was last given a flow
  const [hid, setHid] = useState(false); // "Không": the bar stays away until the next edit or "Cập nhật lên ticket"
  const [saved, setSaved] = useState<FlowSaved | null>(null);
  const [ask, setAsk] = useState<"close" | "again" | "fresh" | null>(null);
  const [note, setNote] = useState("");
  // "Nhanh": the light YouTrack picks (Hỏi AI…), enough once the Zeplin texts come with the ticket; "Kỹ": the heavy
  // picks, for a long or tangled story. Remembered per browser.
  const [deep, setDeep] = useState(() => getPref("uiflowDeep") === "1");
  const [shown, setShown] = useState(true); // false: sliding out; `onClose` comes when that animation ends

  const q = useQuery({ ...ytFlowQuery(issue), enabled: open });
  const flow = mine?.flow ?? q.data?.flow ?? null;
  const base = mine ? mine.base : q.data?.att ?? null;
  // the Zeplin screens the flow links (edits included): frames drawn from their images; the engine mounts once the
  // first answer is in (or failed), so it lays out with them and never shifts frames under the user
  const [edited, setEdited] = useState<string | null>(null); // the edited flow's links, "\n"-joined
  const urls = edited !== null ? edited.split("\n").filter(Boolean) : zeplinUrls(flow);
  const sq = useQuery({
    queryKey: ["yt", "flow-shots", ...urls], queryFn: ({ signal }) => yt.flowShots(urls, signal),
    enabled: open && !!flow && urls.length > 0, staleTime: 30 * 60_000, retry: false, placeholderData: keepPreviousData,
  });
  const shotsReady = !urls.length || !!sq.data || sq.isError;
  const engine = useUiFlow(el, shotsReady ? flow : null, {
    lang, shots: sq.data?.shots,
    onChange: (f, d) => {
      setDirty(d);
      if (d) setHid(false);
      const k = zeplinUrls(f).join("\n");
      setEdited((e) => (e === k ? e : k));
    },
  });

  const ctl = useRef<AbortController | null>(null); // the AI run, so Dừng cancels the request
  // a background run on the server (X-Ai-Job), its id kept per ticket: closing the dialog leaves it going, opening it
  // again reads it (`again`: that run) — still running, its result, or its error, the same as a run started here.
  // Its result saves over the file the run started from (`base`), so a save made meanwhile gets the 409, not overwritten.
  const ai = useMutation({
    mutationFn: async (again?: FlowJob) => {
      ctl.current?.abort(); // a new run replaces the old one, on the server too
      const c = (ctl.current = new AbortController());
      const job = again ?? { id: newJobId(), base: q.data?.att ?? null };
      aiJobs.set(c.signal, job.id);
      if (!again) setFlowJob(issue, job);
      try {
        const r = again
          ? await yt.aiJob<{ flow: UiFlow }>(job.id, c.signal).catch((e) => { if (statusOf(e) === 404) return null; throw e; }) // gone (a restart): nothing to show
          : await yt.aiFlow(issue, note.trim(), deep, c.signal);
        return r && r.flow?.ticket === issue ? { flow: r.flow, base: job.base } : null; // another ticket's: not this one's flow
      } finally {
        if (c.signal.reason !== AI_LEAVE) setFlowJob(issue, null, job.id); // shown, failed or stopped: nothing left to read
      }
    },
    retry: false,
    onSuccess: (r) => { if (r) { setMine(r); setHid(false); setNote(""); } },
  });
  const save = useMutation({
    mutationFn: async (f: UiFlow) => {
      const p = await packShots(f, sq.data?.shots); // the images go into the file, so it opens anywhere, offline
      const r = await yt.saveFlow(issue, f, base, p.shots);
      const lost = p.failed ? t("{n} ảnh Zeplin chưa nhúng được vào file, màn đó vẽ khung đơn giản", { n: p.failed }) : "";
      return { ...r, warn: [r.warn, lost].filter(Boolean).join(". ") };
    },
    retry: false, // an upload whose outcome is unknown must never be sent again on its own
    onSuccess: (r, f) => {
      qc.setQueryData(ytFlowQuery(issue).queryKey, { att: r.att, flow: { ...f, rev: r.rev }, broken: false });
      // the canvas stayed editable during the upload: what was changed meanwhile is kept, unsaved, over the new file
      const now = engine.api?.get();
      setMine(now && JSON.stringify(now) !== JSON.stringify(f) ? { flow: { ...now, rev: r.rev }, base: r.att } : null);
      setDirty(false);
      setSaved(r);
      void qc.invalidateQueries({ queryKey: ["yt", "detail", issue] }); // its attachments and the new comment
      // no invalidate of the flow key: the answer above is the saved version, and a refetch would api.set over the view
    },
  });
  const reread = useRef(false); // the stored run is read once per open (not again on a refetch of the file)
  // the dialog closed: stop reading, the server's run goes on (opening the dialog again reads it)
  useEffect(() => () => { ctl.current?.abort(AI_LEAVE); ctl.current = null; }, []); // a real close unmounts: `reread` goes with it
  useEffect(() => { // a run left going: once the ticket's file is read, read it again — never over unsaved edits
    if (!q.isSuccess || reread.current) return;
    reread.current = true;
    const j = !ctl.current && !mine && !dirty && flowJob(issue);
    if (j) ai.mutate(j);
  }, [q.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps -- once per open; `ai` / `issue` are this dialog's
  useEffect(() => { // what changed, shown for a moment
    if (!saved) return;
    const k = setTimeout(() => setSaved(null), CHANGES_MS);
    return () => clearTimeout(k);
  }, [saved]);

  const unsaved = !!mine || dirty;
  // a render replaces the flow and unmounts the engine, so the edits it held are gone with it
  const run = () => { setSaved(null); setDirty(false); setEdited(null); save.reset(); ai.mutate(undefined); };
  const stopAi = () => { ctl.current?.abort(); ctl.current = null; ai.reset(); }; // → DELETE the server's run, the key goes
  const close = () => { if (unsaved) setAsk("close"); else setShown(false); };
  const fresh = () => { // "Xem bản mới": drop my version, read the ticket's
    setMine(null);
    setDirty(false);
    setEdited(null);
    save.reset();
    void qc.invalidateQueries({ queryKey: ytFlowQuery(issue).queryKey });
  };

  const waiting = useAiWait(q.isPending || ai.isPending || (!!flow && !shotsReady));
  const conflict = statusOf(save.error) === 409;
  // the ticket's file could not be read: never the empty state, and no Render here (what it would replace is unknown)
  const readErr = q.isError && !flow;
  const body = readErr ? <Center>
      <p role="alert" className="max-w-sm text-sm text-error">{t("Không đọc được UI flow của ticket: {msg}", { msg: say(q.error) })}</p>
      <Button size="sm" variant="outline" onClick={() => void q.refetch()}><RotateCw aria-hidden />{t("Thử lại")}</Button>
    </Center>
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
            <FlowMenu issue={issue} att={q.data?.att ?? null} onAgain={() => (flow ? setAsk("again") : run())} className="ml-auto" />
            <Button data-autofocus size="icon-sm" variant="ghost" aria-label={t("Đóng")} onClick={close}><X /></Button>
          </header>
          <div className="relative min-h-0 flex-1">{body}</div>
          <footer className="shrink-0 border-t border-rule bg-paper-2 p-3">
            {readErr ? null : unsaved && !hid && !waiting && engine.api ? (
              <div className="flex flex-wrap items-center gap-2">
                <p role="status" className="min-w-0 flex-1 text-sm text-ink">{t("Có thay đổi chưa lưu — cập nhật file trên ticket?")}</p>
                <Button size="sm" aria-busy={save.isPending} disabled={save.isPending} onClick={() => engine.api && save.mutate(engine.api.get())}>{t("Cập nhật")}</Button>
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
            {sq.isError && flow && <p role="alert" className="mt-2 text-xs text-warn">{t("Không lấy được ảnh Zeplin: {msg}", { msg: say(sq.error) })}</p>}
            {!!sq.data?.missing.length && flow && <p className="mt-2 text-xs text-ink-3">{t("{n} màn Zeplin không đọc được (chưa chia sẻ với tài khoản này hoặc đã xoá)", { n: sq.data.missing.length })}</p>}
            {ai.isError && (ai.error as Error).name !== "AbortError" && <p role="alert" className="mt-2 text-sm text-error">{t("Không render được: {msg}", { msg: say(ai.error) })}</p>}
            {save.isError && (
              <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-error">
                {say(save.error)}
                {conflict && <Button size="xs" variant="outline" onClick={() => (unsaved ? setAsk("fresh") : fresh())}>{t("Xem bản mới")}</Button>}
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
      <ConfirmDialog open={ask === "close"} onOpenChange={(o) => !o && setAsk(null)} title={t("Bỏ thay đổi chưa lưu?")}
        description={t("Đóng UI flow sẽ mất các thay đổi chưa cập nhật lên ticket.")} confirmLabel={t("Bỏ thay đổi")}
        onConfirm={() => { setAsk(null); setShown(false); }} />
      {/* after a 409: the ticket's version replaces mine, and mine cannot be read back */}
      <ConfirmDialog open={ask === "fresh"} onOpenChange={(o) => !o && setAsk(null)} title={t("Bỏ thay đổi chưa lưu?")}
        description={t("Xem bản mới trên ticket sẽ mất các thay đổi chưa lưu của bạn.")} confirmLabel={t("Xem bản mới")}
        onConfirm={() => { setAsk(null); fresh(); }} />
      {/* a render replaces the flow on screen, so say so — and name the loss when something is unsaved */}
      <ConfirmDialog open={ask === "again"} onOpenChange={(o) => !o && setAsk(null)} tone="default" icon={Sparkles}
        title={t("Render lại bằng AI?")}
        description={unsaved
          ? t("Render lại sẽ bỏ các thay đổi chưa lưu. AI dựng lại sơ đồ từ ticket, thay sơ đồ đang xem.")
          : t("AI dựng lại sơ đồ từ ticket, thay sơ đồ đang xem. File trên ticket chỉ đổi khi bạn bấm Cập nhật.")}
        confirmLabel={t("Render lại")} onConfirm={() => { setAsk(null); run(); }} />
    </>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <div className="grid h-full w-full place-content-center justify-items-center gap-3 p-6 text-center">{children}</div>
);

/** The dialog's "⋯": render the flow again, or download the file the ticket holds. */
function FlowMenu({ issue, att, onAgain, className }: { issue: string; att: string | null; onAgain: () => void; className?: string }) {
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
            <Menu.Item onClick={onAgain} className={cn(MENU_ITEM, MENU_ACTION)}><Sparkles aria-hidden />{t("Render lại bằng AI")}</Menu.Item>
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
