"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, LibraryBig, SquareTerminal, MessageSquareText, Plus, RotateCcw, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AiPromptBox, AiSend, UserBubble, useFollow } from "@/components/ai/chat";
import { Button } from "@/components/ui/button";
import { ProjectPicker, useProjects } from "@/components/project-picker";
import { Hint } from "@/components/ui/hint";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/inbox";
import { getPref, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AI_MAX, type Ticket, yt } from "@/lib/yt";
import { AiBox, StatePill, useAi, YtPicks } from "./bits";
import { type AiSession, useHistory } from "./history";
import { type AiAuto, type AiStart, useYt } from "./state";
import { type Builtin, builtin, fitsCount, PromptsDialog, shownFor, usePrompts } from "./prompts";

/** A ticket ID or a bare number (of the current project), several per text. */
const TICKET_RE = /[A-Z][A-Z0-9_]*-\d+|\b\d+\b/gi;

// Many tickets picked → AI: the tickets quoted, one prompt about them, follow-ups in the box. A folder: the AI also
// reads that code (read-only). Every session stays in the YouTrack tab (its history), never in Telegram › AI Agent.

/** The AI session every AI action opens: `auto` is the run it starts with (or a saved answer to show), then the chat goes on here. */
export function WorkView({ title, ids: initial, auto, start, resume }: { title: string; ids: string[]; auto?: AiAuto; start?: AiStart; resume?: AiSession }) {
  const t = useT();
  const y = useYt();
  // every turn is kept in the history as it starts (pending), then with its answer; a new conversation (run, Cuộc mới,
  // other tickets) gets a new entry
  const [ids, setIds] = useState(initial);
  const { onTurn, againRef } = useHistory(title, ids, resume?.id);
  const ai = useAi(onTurn);
  const [retry, setRetry] = useState(resume?.pending); // a saved turn that never got its answer
  const attached = useRef(false);
  const viewOnly = !!resume && !resume.req && !initial.length; // a saved AI filter / ticket draft: nothing to ask on
  function rerun() {
    const p = retry!, r = resume!.req!;
    setRetry(undefined);
    if (resume!.thread.length) { void ai.ask(p.q); return; } // a follow-up: asked again on the seeded thread
    againRef.current = true;
    void ai.run({ label: p.label, q: p.q, run: (sig) => yt.aiAgain(r, sig) });
  }
  const ps = useProjects();
  const notes = useQuery({ queryKey: ["yt", "notes"], queryFn: () => yt.notes(), staleTime: 60_000 });
  const noted = !!notes.data?.[y.mode]?.trim(); // this role's team instructions go into every prompt
  const [prompt, setPrompt] = useState("");
  const [saved, setSaved] = useState(false); // the saved-prompts popup
  // "": no folder, the AI reads the tickets only; remembered per YouTrack project
  const [project, setProjectState] = useState(() => getPref(`ytFolder:${y.project}`) ?? "");
  const setProject = (p: string) => { setProjectState(p); setPref(`ytFolder:${y.project}`, p || null); };
  // the AI may also run commands in that folder (build, test, gradle), sandboxed; off by default
  const [shell, setShellState] = useState(() => getPref(`ytShell:${y.project}`) === "1");
  const setShell = (on: boolean) => { setShellState(on); setPref(`ytShell:${y.project}`, on ? "1" : null); };
  const [add, setAdd] = useState("");
  const [found, setFound] = useState<Record<string, Ticket>>({}); // added tickets outside the loaded scope, looked up
  const [looking, setLooking] = useState(false);
  const [openList, setOpenList] = useState<boolean | null>(null); // the ticket list unfolded; null = auto, folded by every run
  const calm = useReducedMotion();
  const list = ids.slice(0, AI_MAX);
  const rows = list.map((id) => y.rows.find((i) => i.id === id) ?? found[id] ?? { id, summary: null, state: null, type: null });
  const scope = `${list.length} ticket đã chọn`;
  const busy = ai.s.status === "busy";
  const folders = ps.data ?? [];
  // code (read, run commands) is Dev only; no tickets (a report, figures): no code to read
  const dev = y.mode === "dev";
  const folder = list.length && dev ? folders.find((p) => p.path === project) : undefined;
  const dir = folder?.path ?? ""; // no edits, the answer streams here
  const sh = !!dir && shell;

  const one = list.length === 1 ? list[0] : null;
  const { lib } = usePrompts();
  const fits = (b: Builtin) => list.length > 0 && fitsCount(b, list.length > 1);
  // asked: the tickets now live in the AI history, so the table's selection of them is let go
  const unpick = () => y.setPicked((p) => (list.some((id) => p.has(id)) ? new Set([...p].filter((id) => !list.includes(id))) : p));
  function runBuiltin(b: Builtin) {
    setRetry(undefined);
    unpick();
    const k = b.kind;
    const run = (sig: AbortSignal) =>
      k === "notes" ? yt.aiData("notes", rows.map((r) => ({ id: r.id, type: r.type, summary: r.summary })), sig)
      : k === "summary" || k === "review" ? yt.aiTickets(list, scope, k, sig, "", undefined, 0, [], dir, sh)
      : k === "testcases" ? (one ? yt.aiTickets([one], one, "testcases", sig, "", undefined, 0, [], dir, sh) : yt.aiTickets(list.slice(0, 10), scope, "testcases", sig, "", undefined, 0, [], dir, sh))
      : yt.aiTicket(one!, k, sig, dir, sh);
    setOpenList(false); // the answer gets the room
    void ai.run({ label: `AI: ${t(b.name).toLowerCase()}`, run });
  }
  /** A built-in runs its job, a saved prompt is sent as the question. */
  function pick(name: string) {
    const b = builtin(name);
    if (b) { if (fits(b)) runBuiltin(b); else toast({ text: t(b.for === "one" ? "“{name}” cần đúng 1 ticket" : "“{name}” cần từ 2 ticket", { name: t(b.name) }) }); return; }
    const p = lib.prompts.find((x) => x.name === name);
    if (p) { setPrompt(p.text); void send(p.text); } // kept in the box if it can't go now
  }
  // the buttons: the team's pick for this role and ticket count (max 5), else the role's default 4
  const chips = !list.length ? [] : shownFor(lib, `${y.mode}:${list.length > 1 ? "many" : "one"}`).filter((n) => { const b = builtin(n); return b ? fits(b) : lib.prompts.some((p) => p.name === n); });
  // the run this session was opened for (once), or the saved answer it shows
  useEffect(() => {
    if (resume) {
      ai.seed(resume.thread, resume.req);
      const p = resume.pending;
      // a turn whose page was reloaded / closed, or whose view was left while it ran: its server run may still go on
      // (read live: steps and text as they come) or hold the answer
      if (p?.job && !attached.current) {
        attached.current = true; // once: a second effect run (Strict Mode) would abort it, and so stop the server's run
        againRef.current = true;
        void ai.attach({ ...p, job: p.job }, resume.req, resume.thread).then((r) => { if (r) setRetry(undefined); });
      }
      return;
    }
    if (!auto) return;
    if (auto.seed) { ai.seed([{ q: "", a: auto.seed.text }], auto.seed.req); return; }
    void ai.run(auto).then((r) => { if (r?.text) auto.onDone?.({ text: r.text, req: r.req }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one run per opened session

  async function send(text = prompt) {
    const ask = text.trim();
    if (!ask || busy) return;
    setRetry(undefined);
    setOpenList(false); // the answer gets the room
    if (ai.canAsk) { setPrompt(""); void ai.ask(ask); return; } // same chat: a follow-up (same folder as its first run)
    if (!list.length) { // a session about figures: the first prompt starts it, then follow-ups
      if (start) { setPrompt(""); void ai.run({ label: start.label, q: ask, run: (sig) => start.ask(ask, sig) }); }
      return;
    }
    setPrompt("");
    unpick();
    void ai.run({ label: dir ? t("AI đang đọc {n} ticket và code {name}", { n: list.length, name: folder!.name }) : t("AI đang đọc {n} ticket", { n: list.length }), q: ask, run: (sig) => yt.aiTickets(list, scope, "ask", sig, ask, undefined, 0, [], dir, sh) });
  }

  // the AI chat is about one ticket set: changing the set starts a new one
  function change(next: string[]) { if (!busy) { ai.cancel(); setIds(next); } }
  /** Add every ticket ID in the text (one, or many: "VA-1, VA-2"); the ones outside the loaded list are looked up first. */
  async function addIds(text: string) {
    // a bare number is a ticket of the current project: "123" = "VA-123"
    const want = [...new Set((text.toUpperCase().match(TICKET_RE) ?? []).map((t) => (/^\d+$/.test(t) ? `${y.project}-${t}` : t)))].filter((id) => !ids.includes(id));
    if (!want.length) { if (!text.match(TICKET_RE)) toast({ text: t("Nhập số ticket (123) hoặc ID ({project}-123)", { project: y.project }) }); setAdd(""); return; }
    setAdd("");
    const unknown = want.filter((id) => !y.rows.some((i) => i.id === id));
    setLooking(true);
    const res = await Promise.all(unknown.map((id) => yt.detail(id).then((t): Ticket => t, (e: Error) => `${id}: ${e.message}`)));
    const got = res.filter((t): t is Ticket => typeof t !== "string"), why = res.find((t): t is string => typeof t === "string");
    setLooking(false);
    setFound((f) => ({ ...f, ...Object.fromEntries(got.map((t) => [t.id, t])) }));
    const ok = want.filter((id) => !unknown.includes(id) || got.some((t) => t.id === id));
    if (ok.length) change([...new Set([...ids, ...ok])]);
    if (ok.length < want.length) toast({ text: `${t("Không thêm được {ids}", { ids: want.filter((id) => !ok.includes(id)).join(", ") })}${why ? ` (${why})` : ""}` });
  }

  // chat-like: newest content at the bottom, kept in view as it streams in unless the reader scrolled up
  const { ref: feedRef, onScroll: onFeedScroll } = useFollow(ai.s.status === "busy" ? `${ai.s.text?.length ?? 0}:${ai.s.steps?.length ?? 0}` : 0, `${ai.s.status}:${ai.thread.length}`); // a new turn or answer: back to the bottom
  const chatting = ai.thread.length > 0 || ai.s.status !== "idle";
  const unfolded = openList ?? (!chatting && rows.length <= 4); // auto until toggled: the answer gets the room
  const openOne = (id: string) => y.openTicket(id, list.map((x) => y.rows.find((i) => i.id === x) ?? found[x]).filter((i): i is Ticket => !!i));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* the tickets: one slim line (count, the ids, an add box) that never crowds the answer. "N ticket" unfolds the full
          list (id, title, state) within a third of the screen; it folds again when a prompt is sent */}
      <div className="grid shrink-0 rounded-[var(--radius-card)] bg-paper-2/60 shadow-edge">
        <div className="flex h-9 items-center gap-1 px-1">
          {!!rows.length && <Hint side="bottom" text={t(unfolded ? "Thu gọn danh sách ticket" : "Xem tiêu đề, trạng thái từng ticket")}><button type="button" onClick={() => setOpenList(!unfolded)} aria-expanded={unfolded} aria-controls="work-tickets"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-ink-2 hover:bg-paper-3 hover:text-ink">
            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short)", unfolded && "rotate-90")} aria-hidden />{t.n("{n} ticket", { n: <span className="tabular-nums">{rows.length}</span> })}</button></Hint>}
          <div className="relative min-w-0 flex-1 self-stretch">
            <AnimatePresence initial={false}>
              {!unfolded && (
                <motion.div key="chips" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: calm ? 0 : 0.15 }}
                  className="no-scrollbar absolute inset-0 flex items-center gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] pr-6">
                  {rows.map((r) => (
                    <Hint key={r.id} side="bottom" text={r.summary ?? r.id}><button type="button" onClick={() => openOne(r.id)}
                      className="inline-flex h-6 shrink-0 items-center rounded-full bg-cotton px-2 font-mono text-xs shadow-edge hover:text-hl-2">{r.id}</button></Hint>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <form className="relative shrink-0" onSubmit={(e) => { e.preventDefault(); void addIds(add); }}>
            {/* Enter adds; a suggestion picked (not typed) adds at once; a paste with several numbers / IDs adds them all */}
            <Plus className="pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input list="work-add-ids" value={add} disabled={looking || busy || ids.length >= AI_MAX} maxLength={500} aria-label={t("Thêm ticket: số hoặc ID, nhiều cái cách dấu phẩy, Enter")}
              placeholder={t(looking ? "Đang tìm…" : "Thêm 123, 456")}
              onChange={(e) => { const t = (e.nativeEvent as InputEvent).inputType; if ((!t || t === "insertReplacementText") && y.rows.some((i) => i.id === e.target.value)) void addIds(e.target.value); else setAdd(e.target.value); }}
              onPaste={(e) => { const t = e.clipboardData.getData("text"); if ((t.match(TICKET_RE) ?? []).length > 1) { e.preventDefault(); void addIds(t); } }}
              className="h-7 w-32 rounded-md border border-transparent bg-cotton pr-2 pl-6 font-mono text-xs transition-[width,border-color] duration-(--dur-short) placeholder:font-sans hover:border-rule focus:w-44 focus:border-hl disabled:opacity-60" />
            <datalist id="work-add-ids">{y.rows.filter((i) => !ids.includes(i.id)).slice(0, 500).map((i) => <option key={i.id} value={i.id}>{i.summary}</option>)}</datalist>
          </form>
        </div>
        <AnimatePresence initial={false}>
          {unfolded && !!rows.length && (
            <motion.div key="list" id="work-tickets" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: calm ? 0 : 0.22, ease: [0.2, 0, 0, 1] }} className="overflow-hidden">
              <ul aria-label={t("Ticket của phiên")} className="grid max-h-[min(14rem,30dvh)] gap-px overflow-y-auto border-t border-rule/70 p-1">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-md hover:bg-cotton">
                    <button type="button" onClick={() => openOne(r.id)} className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 px-1.5 py-1 text-left text-sm">
                      <b className="font-mono text-xs font-medium text-ink-2">{r.id}</b><span className="truncate">{r.summary ?? "—"}</span>{r.state && <StatePill state={r.state} />}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
        {ids.length > AI_MAX && <p className="border-t border-rule/70 px-2 py-1 text-xs text-warn">{t("Chỉ đọc {n} / {all} ticket đầu.", { n: AI_MAX, all: ids.length })}</p>}
      </div>

      <div ref={feedRef} onScroll={onFeedScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" aria-live="polite">
        {!chatting && !retry && (
          <p className="m-auto max-w-sm text-center text-sm text-ink-3">
            <Sparkles className="mx-auto mb-2 size-5 text-hl-2" />
            {start && !list.length ? t("Hỏi AI về “{title}”: số liệu đang nói gì, bất thường, nguyên nhân, việc nên làm… Nhập câu hỏi rồi Enter.", { title: title.replace(/^AI · /, "") })
              : <>{t("Hỏi bất kỳ điều gì về {n} ticket ở trên, hoặc chọn một gợi ý bên dưới.", { n: list.length })}{dev && ` ${t("Chọn thư mục dự án để AI đọc code.")}`}</>}
          </p>
        )}
        <AiBox ai={ai} stop={false} onUse={one && !y.config?.mock ? (text) => y.setSheet({ kind: "ticket", id: one, nav: [], comment: text }) : undefined} />
        {retry && ai.s.status !== "busy" && <>
          {retry.q && <UserBubble>{retry.q}</UserBubble>}
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            {t("{what} chưa có trả lời (bị dừng, lỗi, hoặc trang đã tải lại).", { what: retry.q ? t("Câu hỏi này") : retry.label })}
            {resume?.req && <Button type="button" size="xs" variant="outline" onClick={rerun}><RotateCcw /> {t("Chạy lại")}</Button>}
          </p>
        </>}
      </div>

      {viewOnly ? <p className="shrink-0 px-1 text-xs text-ink-3">{t("Phiên này (lọc / soạn ticket bằng AI) chỉ để xem lại, không hỏi tiếp được.")}</p> : <div className="grid shrink-0 gap-1.5">
        <AiPromptBox aria-label={t("Yêu cầu cho AI về các ticket đã chọn")} autoFocus maxLength={2000} value={prompt} onChange={setPrompt} onSend={() => void send()}
          running={busy} onStop={ai.stop} stopLabel={t("Hủy")}
          placeholder={t(ai.canAsk ? "Hỏi tiếp…" : start && !list.length ? "Hỏi về số liệu này (Enter gửi, Shift+Enter xuống dòng)" : "Hỏi về các ticket này: phụ thuộc, thứ tự làm, ước lượng, rủi ro, test case… (Enter gửi, Shift+Enter xuống dòng)")}
          top={
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((n) => {
                const b = builtin(n);
                return (
                  <Hint key={n} side="bottom" title={b ? t(b.name) : n} text={(b ? t(b.hint) : lib.prompts.find((p) => p.name === n)?.text ?? "").slice(0, 240)}><button type="button" disabled={busy} onClick={() => pick(n)}
                    className="inline-flex h-7 max-w-52 items-center gap-1.5 rounded-full bg-paper-2 px-2.5 text-xs font-medium text-ink-2 ring-1 ring-rule transition-colors duration-(--dur-micro) hover:bg-hl-wash hover:text-hl-2 hover:ring-hl/40 disabled:pointer-events-none disabled:opacity-50">
                    {b ? <Sparkles className="size-3.5 shrink-0 opacity-70" /> : <MessageSquareText className="size-3.5 shrink-0 opacity-70" />}<span className="truncate">{b ? t(b.name) : n}</span>
                  </button></Hint>
                );
              })}
              <Hint side="bottom" text={t("Mở kho prompt: chạy, ghim, thêm, sửa, xóa")}><button type="button" onClick={() => setSaved(true)}
                className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium border border-dashed border-rule-2 text-ink-3 transition-colors duration-(--dur-micro) hover:border-ink-3 hover:text-ink">
                <LibraryBig className="size-3.5" />{t(chips.length ? "Kho prompt" : "Kho prompt: chọn hoặc ghim prompt")}
              </button></Hint>
              {noted && <Hint side="bottom" title={t("Instructions của team")} text={notes.data![y.mode].slice(0, 300)}><span className="ml-auto rounded-full bg-hl-wash px-2 text-xs leading-5 font-medium text-hl-2">{t("Có instructions {role}", { role: ({ dev: "Dev", qa: "QC", po: "PO" })[y.mode] })}</span></Hint>}
              {chatting && <Hint side="bottom" text={t("Bắt đầu cuộc trò chuyện mới với các ticket này")}><Button type="button" size="xs" variant="ghost" className={noted ? "" : "ml-auto"} disabled={busy} onClick={ai.cancel}><RotateCcw /> {t("Cuộc mới")}</Button></Hint>}
            </div>
          }
          tools={!!list.length && dev && <>
            <Hint side="bottom" text={t("Thư mục dự án để AI đọc code khi trả lời")}><span className="min-w-0 max-w-56">
              <ProjectPicker value={project} onChange={setProject} none={t("Không đọc code")} chip className="max-w-56" />
            </span></Hint>
            {folder && <Hint side="bottom" title={t(shell ? "AI được chạy lệnh" : "AI chỉ đọc code")}
              text={t("Bật: AI được chạy lệnh trong thư mục dự án (build, test, gradle…) trong sandbox: chỉ ghi trong thư mục đó, mạng chỉ tới kho thư viện (Maven, npm, PyPI); không sửa code. Antigravity không có sandbox nên vẫn chỉ đọc.")}>
              <Button type="button" size="xs" variant="ghost" aria-pressed={shell} aria-label={t("Cho AI chạy lệnh")} disabled={busy} onClick={() => setShell(!shell)}
                className={cn("h-7 rounded-full", shell && "bg-hl-wash text-hl-2 hover:bg-hl-wash")}><SquareTerminal /> {t("Chạy lệnh")}</Button>
            </Hint>}
          </>}
          actions={<>
            {/* A follow-up runs like the first request; a new one is heavy with code or over 10 tickets (as the server decides). */}
            <YtPicks heavy={ai.canAsk ? ai.heavy : !!dir || list.length > 10} />
            <AiSend onClick={() => void send()} busy={busy} disabled={!prompt.trim() || (!list.length && !ai.canAsk && !folder && !start)} />
          </>} />
        {folder && <p className="px-1 text-xs text-ink-2">{t(shell ? "Gợi ý và câu hỏi sẽ đọc code trong {name} (được chạy lệnh trong sandbox), trả lời ngay ở trên; chậm hơn, thường 1–3 phút, lâu hơn nếu build." : "Gợi ý và câu hỏi sẽ đọc code trong {name} (chỉ đọc), trả lời ngay ở trên; chậm hơn, thường 1–3 phút.", { name: folder.name })}</p>}
      </div>}
      <PromptsDialog open={saved} onOpenChange={setSaved} onPick={pick} role={y.mode} many={list.length > 1} />
    </div>
  );
}
