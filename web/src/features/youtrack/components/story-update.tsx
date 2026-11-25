"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, FilePenLine, Loader2, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useRef, useState } from "react";
import { groupsQuery } from "@/features/telegram/lib/inbox";
import { useGroupSend } from "@/features/telegram/hooks/use-group-send";
import { findMember, groupsMembers } from "@/features/telegram/lib/mentions";
import { AiAsk, Markdown, Picker, YtPicks } from "@/features/youtrack/components/bits";
import { NoteBox, useNote } from "@/features/youtrack/components/story-notify";
import { ytPeople } from "@/features/youtrack/lib/mentions";
import { type Attachment, yt, ytDetailQuery, ytFail, ytMeQuery } from "@/features/youtrack/lib/yt";
import { AiPromptBox, AiResultCard, AiThinking } from "@/shared/components/ai/chat";
import { Avatar } from "@/shared/components/avatar";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { Fold } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Textarea } from "@/shared/components/ui/textarea";
import { errorText } from "@/shared/lib/api";
import { t as tr, tMaybe, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn, lineDiff } from "@/shared/lib/utils";

const ID = /^[A-Z][A-Z0-9]*-\d+$/;
const LABEL = "text-xs font-medium text-ink-3";
/** The changed lines with 2 lines of context around them; "…" where unchanged lines are skipped. memo: the diff is not
 *  made again on every key typed elsewhere in the dialog. */
const Changes = memo(function Changes({ before, after }: { before: string; after: string }) {
  const t = useT();
  const d = lineDiff(before, after);
  const near = (k: number) => d.slice(Math.max(0, k - 2), k + 3).some(([op]) => op !== " ");
  const rows = d.map((r, k) => (near(k) ? r : null));
  if (!d.some(([op]) => op !== " ")) return <p className="text-sm text-ink-3">{t("Không có thay đổi so với mô tả hiện tại.")}</p>;
  return (
    <div aria-label={t("So sánh")} className="min-h-64 overflow-x-auto rounded-md border border-rule bg-cotton py-1 font-mono text-sm">
      {rows.map((r, k) => r ? (
        <div key={k} className={cn("px-3 whitespace-pre-wrap", r[0] === "+" ? "bg-ok-wash text-ink" : r[0] === "-" ? "bg-error-wash text-ink-2 line-through decoration-error/50" : "text-ink-3")}>
          <span aria-hidden className="mr-2 inline-block w-3 select-none">{r[0]}</span>{r[1] || " "}
        </div>
      ) : rows[k - 1] ? <div key={k} aria-hidden className="px-3 text-ink-3">…</div> : null)}
    </div>
  );
});

const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.18 } } as const;
const uniq = (l: (string | null | undefined)[]) => [...new Set(l.filter((x): x is string => !!x))];

const NONE: Attachment[] = [];
/** The description as YouTrack will render it. memo: not rendered again on every key typed in the message boxes. */
const Rendered = memo(function Rendered({ id, text, files }: { id: string; text: string; files: Attachment[] }) {
  const t = useT();
  if (!text.trim()) return <p className="text-sm text-ink-3">{t("Chưa có mô tả.")}</p>;
  return <Markdown text={text} files={{ issue: id, list: files }} className="min-h-64 rounded-md border border-rule bg-cotton p-3" />;
});

/** Cập nhật story: the ticket's description, opened to edit by hand and saved on YouTrack ("Lưu", only over the text it was
 *  read as). AI is one chip away: it takes a change (a decision just made, a missing AC) and writes the whole description
 *  back into the same box, shown as a diff to review. The box has three views: "Viết" (the text), "So sánh" (its diff
 *  against what YouTrack has) and "Xem trước" (rendered as YouTrack will show it). Telling people (story-notify.tsx): a
 *  YouTrack comment and a Telegram message, each its own box (typed freely, "@" lists that platform's people, quick
 *  groups) and its own send button; neither waits for the other nor for "Lưu". The two platforms name people
 *  differently, so each ready-made line tags the ticket's Assignee / QC (not me) its own way. "Thêm bình luận và gửi
 *  Telegram" (off on every open): a save then also sends both, as their own buttons would.
 *  `ids`: tickets the change names (one: fixed; none or several: typed). `notify`: the Telegram group to tell and the
 *  message there to reply to. No group (none names the ticket yet): the user picks among their groups, several at once
 *  (the message goes to each); no message: a new message in the group (the Q&A post). `onSaved`: the ticket the description was
 *  saved on. `note`: the change as its caller has it (a Briefing item), shown beside the editor and handed to the AI.
 *  `draft`: a description already written (a "Chuẩn hoá mô tả" answer and the text it was made on), opened on its diff.
 *  Mount only while open. */
export function StoryUpdate({ ids, note: startNote, draft: start, notify, onSaved, onClose }: {
  ids: string[]; note: string; draft?: { text: string; base: string }; notify?: { chatId: string; replyTo?: string }; onSaved?: (id: string) => void; onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [id, setId] = useState(ids[0] ?? "");
  const ok = ID.test(id);
  // read again on open: the box starts from the description as YouTrack has it now, and the save is checked against it
  const ticket = useQuery({ ...ytDetailQuery(id), enabled: ok, retry: false, refetchOnMount: "always" });
  const cur = ticket.data?.description ?? "";
  const [edit, setEdit] = useState<{ text: string; base: string } | null>(start ?? null); // null: untouched, the box shows `cur`
  const desc = edit?.text ?? cur, base = edit?.base ?? cur; // base: the text the edit was made on (the AI's: sent back with its answer)
  const [view, setView] = useState<"write" | "diff" | "preview">(start ? "diff" : "write");
  const [note, setNote] = useState(startNote);
  const [aiOpen, setAiOpen] = useState(false);
  const [also, setAlso] = useState(false); // "Thêm bình luận và gửi Telegram": a save also sends both messages
  const abort = useRef<AbortController | null>(null);

  const me = useQuery(ytMeQuery).data;
  const [picked, setPicked] = useState<string[]>([]); // no group names the ticket: the ones picked here, each gets the message
  const chats = notify ? [notify.chatId] : picked;
  const groups = useQuery({ ...groupsQuery, retry: false, enabled: !notify });
  const titles = (ids: string[]) => (groups.data ?? []).filter((g) => ids.includes(g.chat_id)).map((g) => g.title).join(", ");
  const yts = ytPeople(id.split("-")[0]), tgs = groupsMembers(chats);
  const team = useQuery({ queryKey: yts.queryKey, queryFn: yts.queryFn, select: yts.select, staleTime: 10 * 60_000, enabled: ok });
  const members = useQuery({ queryKey: tgs.queryKey, queryFn: tgs.queryFn, staleTime: 5 * 60_000, retry: false, enabled: chats.length > 0 });
  // each box's ready-made line (until typed over): the ticket's Assignee and QC (never me) tagged that platform's way
  const [body, setBody] = useState<string | null>(null); // the AI's message for the team, once it has drafted (Vietnamese: it goes to the team)
  const line = body ?? (startNote.trim() ? `Đã cập nhật story ${id}: ${startNote.trim()}` : `Đã cập nhật story ${id}, nhờ mọi người check lại mô tả.`);
  const owners = ([[ticket.data?.assigneeLogin, ticket.data?.assignee], [ticket.data?.qcLogin, ticket.data?.qc]] as const).filter(([, n]) => n && n !== me?.name);
  const found = owners.map(([, n]) => [n!, findMember(members.data ?? [], n!)] as const);
  const hit = found.flatMap(([, m]) => (m ? [m] : []));
  const missing = members.data ? found.filter(([, m]) => !m).map(([n]) => n) : []; // named on the ticket, not found in the group
  const { attach: ytAttach, ...ytNote } = useNote(yts, [...uniq(owners.map(([login]) => login)).map((l) => `@${l}`), line].join(" "));
  const { attach: tgAttach, ...tgNote } = useNote(tgs, [...uniq(hit.map((m) => `@${m.username || m.name}`)), line].join(" "),
    Object.fromEntries(hit.filter((m) => !m.username).map((m) => [`@${m.name}`, m.user_id])));
  const [ytSent, setYtSent] = useState(""); // the comment already on the ticket, as sent
  const comment = useMutation({
    mutationFn: (text: string) => yt.comment(id, text),
    onSuccess: (_r, text) => { setYtSent(text); toast({ text: tr("Đã gửi bình luận") }); void qc.invalidateQueries({ queryKey: ["yt", "detail", id] }); },
    onError: (e) => { const f = ytFail(e); toast({ text: tr("Không gửi được: {msg}", { msg: f.msg }), failure: f.failure }); },
  });
  const tg = useGroupSend(chats, notify?.replyTo);
  const tgSame = tg.text === tgNote.wired; // the send's state is about this very text
  /** What each box's own button would send, after a save ("Thêm bình luận và gửi Telegram"): a box left empty, or whose
   *  text is already out, is skipped. A send whose outcome is unknown is never sent again from here (only by its button). */
  const tell = () => {
    if (ytNote.text.trim() && ytSent !== ytNote.wired && !comment.isPending) comment.mutate(ytNote.wired);
    if (!tgNote.text.trim() || tg.busy || (tg.state !== "idle" && tgSame)) return;
    if (!chats.length) return void toast({ text: tr("Chưa chọn nhóm Telegram nên chưa gửi tin.") });
    tg.send(tgNote.wired);
  };

  const draft = useMutation({
    mutationFn: () => {
      abort.current?.abort();
      abort.current = new AbortController();
      return yt.aiTicket(id, "amend", abort.current.signal, "", false, note.trim());
    },
    onSuccess: (r) => { setEdit({ text: r.text, base: r.base ?? "" }); if (r.draft) setBody(r.draft); setView("diff"); save.reset(); },
  });
  const save = useMutation({
    mutationFn: async () => {
      await yt.setDescription(id, desc, base);
      onSaved?.(id);
      return desc;
    },
    onSuccess: (text) => {
      toast({ text: tr("Đã cập nhật story {id}", { id }) });
      setEdit((e) => e && { text: e.text, base: text }); // what YouTrack has now; the dialog stays for the comment / Telegram
      void qc.invalidateQueries({ queryKey: ["yt", "detail", id] });
      if (also) tell();
    },
    onError: (e) => { const f = ytFail(e); toast({ text: tr("Không lưu được mô tả: {msg}", { msg: f.msg }), failure: f.failure }); },
  });
  // another ticket: the run, the edit and the messages written for the old one go with it
  const pickId = (v: string) => { setId(v.trim().toUpperCase()); setEdit(null); setBody(null); ytNote.reset(); tgNote.reset(); abort.current?.abort(); draft.reset(); save.reset(); };
  // the description as YouTrack has it now, in place of the edit (a save refused: it changed there meanwhile)
  const reload = () => { setEdit(null); setView("write"); save.reset(); void ticket.refetch(); };
  const canDraft = ok && !!note.trim() && !draft.isPending;
  const run = () => { if (canDraft) draft.mutate(); };
  const aborted = draft.error?.name === "AbortError";
  const loading = ok && !edit && ticket.isPending, unread = ok && !edit && ticket.isError;
  const changed = desc !== base;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { abort.current?.abort(); onClose(); } }}>
      <DialogContent className={DIALOG_SHEET}>
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="grid gap-2 border-b border-rule bg-paper-2 px-5 pt-5 pb-4">
            <div className="grid gap-1 pr-10">
              <DialogTitle className="flex items-center gap-2"><FilePenLine className="size-4 text-hl" aria-hidden />{t("Cập nhật story")}</DialogTitle>
              <DialogDescription className="text-xs">{t("Sửa mô tả ticket rồi lưu lên YouTrack. Cần thì nhờ AI soạn; bình luận và tin Telegram gửi riêng bằng nút của từng ô, hoặc tick để gửi kèm khi Lưu.")}</DialogDescription>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              {ids.length === 1 ? <span className="shrink-0 rounded-md bg-paper-3 px-1.5 py-0.5 font-mono text-xs text-ink">{id}</span> : (
                <Input value={id} maxLength={30} onChange={(e) => pickId(e.target.value)} autoFocus={!ok}
                  placeholder="VA-123" className="h-8 w-32 shrink-0 font-mono" aria-label={t("Mã ticket")} aria-invalid={!!id && !ok} />
              )}
              <span className="min-w-0 truncate text-xs text-ink-2">
                {!ok ? (id ? t("Mã ticket dạng VA-123") : t("Nhập mã ticket cần cập nhật"))
                  : ticket.isError ? <span className="text-error">{(ticket.error as Error).message}</span>
                  : ticket.data?.summary ?? "…"}
              </span>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 content-start overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-5">
            <div className="grid grid-cols-1 gap-5">
            {!!startNote.trim() && (
              <section className="grid gap-1.5">
                <span className={LABEL}>{t("Nội dung cần đưa vào story")}</span>
                <p className="rounded-md bg-paper-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">{startNote.trim()}</p>
              </section>
            )}

            <section className="grid grid-cols-1 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn(LABEL, "mr-auto")}>{t("Mô tả")}</span>
                <Segmented id="story-view" label={t("Mô tả")} value={view} onChange={setView}
                  items={[{ value: "write", label: t("Viết"), title: t("Sửa mô tả bằng tay") },
                    { value: "diff", label: t("So sánh"), title: t("Dòng thêm / bỏ so với mô tả đang có trên YouTrack") },
                    { value: "preview", label: t("Xem trước"), title: t("Mô tả như YouTrack sẽ hiển thị sau khi lưu") }]} />
                <AiAsk big text="AI" label={t("AI soạn giúp")} hint={t("Ghi thay đổi, mình soạn lại cả mô tả cho bạn duyệt")} onClick={() => setAiOpen((o) => !o)} />
              </div>
              <Fold open={draft.isError && !aborted}>
                <div className="pb-2"><AiResultCard error title={t("Chưa soạn được")}>{(draft.error as Error | null)?.message}</AiResultCard></div>
              </Fold>
              <AnimatePresence mode="wait" initial={false}>
                {draft.isPending ? (
                  <motion.div key="busy" {...fade}><AiThinking label={t("AI đang cập nhật mô tả {id}", { id })} /></motion.div>
                ) : !ok ? (
                  <motion.p key="none" {...fade} className="text-sm text-ink-3">{t("Nhập mã ticket cần cập nhật")}</motion.p>
                ) : loading ? (
                  <motion.div key="load" {...fade} aria-label={t("Đang tải mô tả…")} className="grid min-h-64 content-start gap-2 rounded-md border border-rule bg-cotton p-3">
                    {[96, 88, 92, 60].map((w) => <Skeleton key={w} className="h-3.5" style={{ width: `${w}%` }} />)}
                  </motion.div>
                ) : unread ? (
                  <motion.p key="unread" {...fade} role="alert" className="text-sm text-error">{t("Không đọc được mô tả: {msg}", { msg: (ticket.error as Error).message })}</motion.p>
                ) : (
                  <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                    {view === "diff" ? <Changes before={base} after={desc} /> : view === "preview" ? <Rendered id={id} text={desc} files={ticket.data?.attachments ?? NONE} /> : (
                      <Textarea value={desc} maxLength={60000} autoFocus onChange={(e) => { setEdit({ text: e.target.value, base }); save.reset(); }}
                        className="min-h-64 font-mono text-sm md:text-sm" aria-label={t("Mô tả")} />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section aria-label={t("Báo cho ai")} className="grid grid-cols-1 gap-2">
              <span className={LABEL}>{t("Báo cho ai")}</span>
              <NoteBox label={t("Bình luận trên YouTrack")} note={ytNote} attach={ytAttach} all={team.data ?? []} quickKey="ytQuickTags"
                foot={team.isError && <span role="alert" className="text-xs text-error">{(team.error as Error).message}</span>}
                send={{ run: () => comment.mutate(ytNote.wired), busy: comment.isPending, sent: !!ytSent && ytSent === ytNote.wired, off: !ok,
                  label: ytSent && ytSent === ytNote.wired ? t("Đã gửi bình luận") : t("Gửi bình luận"), hint: t("Thêm bình luận này lên ticket ngay, không cần Lưu mô tả") }} />
              <NoteBox label={t("Tin nhắn Telegram")} note={tgNote} attach={tgAttach} all={members.data ?? []} quickKey="tgQuickTags"
                none={chats.length ? undefined : t("Chọn nhóm Telegram ở trên để thêm người")}
                head={!notify && (groups.isError ? <span role="alert" className="text-xs text-error">{errorText(groups.error, {}, t("Không đọc được danh sách nhóm."))}</span> : (
                  <Picker title={t("Chọn nhóm Telegram")} value="" values={picked} disabled={groups.isLoading} search={t("Tìm nhóm…")} className="bg-paper-3"
                    onPick={(v) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                    label={groups.isLoading ? t("Đang tải nhóm…") : titles(picked) || t("Chọn nhóm")}
                    options={(groups.data ?? []).map((g) => ({ v: g.chat_id, text: g.title, node: <><Avatar name={g.title} className="size-5" /><span className="min-w-0 truncate">{g.title}</span></> }))} />
                ))}
                foot={!chats.length ? <span className="text-xs text-ink-3">{t("Ticket chưa được nhắc ở nhóm nào: chọn một hoặc nhiều nhóm ở trên để gửi.")}</span>
                  : members.isError ? <span role="alert" className="text-xs text-error">{errorText(members.error, Object.fromEntries(Object.entries(tgs.errors ?? {}).map(([k, v]) => [k, tMaybe(v)])))}</span>
                  : tg.failed ? <span role="alert" className="text-xs text-error">{t("Gửi thất bại.")}</span>
                  : tg.state === "unknown" && tgSame ? <span role="alert" className="text-xs text-warn">{chats.length > 1 && tg.lost.length
                    ? t("Chưa rõ nhóm {names} đã nhận tin hay chưa: xem nhóm trước khi gửi lại.", { names: titles(tg.lost) }) : t("Chưa rõ Telegram đã nhận tin hay chưa: xem nhóm trước khi gửi lại.")}</span>
                  : !!missing.length && <span className="text-xs text-ink-3">{t("Chưa thấy {name} trong nhóm: gõ @ để tag", { name: missing.join(", ") })}</span>}
                send={{ run: () => tg.send(tgNote.wired), busy: tg.busy, sent: tg.state === "sent" && tgSame, off: !chats.length,
                  label: tg.state === "sent" && tgSame ? t("Đã gửi vào nhóm") : tg.state === "unknown" && tgSame ? t("Gửi lại") : t("Gửi Telegram"),
                  hint: notify?.replyTo ? t("Gửi ngay thành tin trả lời (reply) tin đã nhắc ticket trong nhóm, không cần Lưu mô tả")
                    : t("Gửi ngay thành tin mới trong từng nhóm đã chọn (có @tên: thêm mã #QA để Q&A theo dõi trả lời)") }} />
            </section>
            </div>
          </div>

          <footer className="grid grid-cols-1 border-t border-rule bg-paper-2 px-5 py-3">
            {/* The AI prompt, opened by the AI chip: pinned at the bottom, its run / stop buttons inside the box (CLAUDE.md: AI prompt). */}
            <Fold open={aiOpen}>
              <div className="pb-3">
                <AiPromptBox aria-label={t("Thay đổi cần đưa vào story")} autoFocus maxLength={8000} placeholder={t("Thay đổi cần đưa vào story")}
                  value={note} onChange={setNote} onSend={run} running={draft.isPending} onStop={() => abort.current?.abort()} stopHint={t("Dừng soạn")}
                  tools={<YtPicks heavy={false} className="min-w-0" />}
                  actions={!draft.isPending && (
                    <Hint text={edit ? t("AI soạn lại từ mô tả trên YouTrack, thay phần đang sửa (Enter)") : t("AI soạn mô tả mới (Enter)")} side="bottom">
                      <Button type="button" size="sm" disabled={!canDraft} onClick={run} className="rounded-full bg-hl text-hl-ink hover:brightness-110">
                        <ArrowUp aria-hidden /> {t("Soạn")}
                      </Button>
                    </Hint>
                  )} />
              </div>
            </Fold>
            {/* Save sits at the left: the bottom-right corner is where the floating assistant bot rests, over dialogs. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" data-story-save disabled={!ok || loading || unread || !changed || !desc.trim() || draft.isPending || save.isPending} aria-busy={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                {t("Lưu")}
              </Button>
              <Hint text={t("Tick: bấm Lưu sẽ lưu mô tả, rồi thêm bình luận lên ticket và gửi tin Telegram vào nhóm đã chọn (ô để trống thì bỏ qua). Không tick: Lưu chỉ ghi mô tả.")}>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <Checkbox checked={also} onCheckedChange={(v) => setAlso(v)} /> {t("Thêm bình luận và gửi Telegram")}
                </label>
              </Hint>
              {save.isError && (
                <Hint side="bottom" text={t("Bỏ bản đang sửa, lấy mô tả mới nhất trên YouTrack")}>
                  <Button size="sm" variant="outline" onClick={reload}><RefreshCw aria-hidden /> {t("Lấy bản mới để sửa")}</Button>
                </Hint>
              )}
              {save.isError ? <span role="alert" className="min-w-0 text-xs text-error">{(save.error as Error).message}</span>
                : save.isSuccess && !changed ? <span className="min-w-0 text-xs text-ok">{t("Đã lưu lên YouTrack")}</span>
                : ok && !loading && !unread && !changed && <span className="min-w-0 text-xs text-ink-3">{t("Không có thay đổi so với mô tả hiện tại.")}</span>}
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
