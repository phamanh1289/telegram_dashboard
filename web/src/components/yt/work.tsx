"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronRight, FolderSearch, LibraryBig, MessageSquareText, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AiPromptBox, useFollow } from "@/components/ai/chat";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { api, type Project } from "@/lib/api";
import { toast } from "@/lib/inbox";
import { getPref, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AI_MAX, type Ticket, yt } from "@/lib/yt";
import { AiBox, StatePill, useAi, YtPicks } from "./bits";
import { type AiSession, newSessionId, saveSession } from "./history";
import { type AiAuto, type AiStart, useYt } from "./state";
import { type Builtin, builtin, fitsCount, PromptsDialog, shownFor, usePrompts } from "./prompts";

/** A ticket ID or a bare number (of the current project), several per text. */
const TICKET_RE = /[A-Z][A-Z0-9_]*-\d+|\b\d+\b/gi;

// Many tickets picked → AI: the tickets quoted, one prompt about them, follow-ups in the box. A folder: the AI also
// reads that code (read-only). Every session stays in the YouTrack tab (its history), never in Telegram › AI Agent.

/** The AI session every AI action opens: `auto` is the run it starts with (or a saved answer to show), then the chat goes on here. */
export function WorkView({ title, ids: initial, auto, start, resume }: { title: string; ids: string[]; auto?: AiAuto; start?: AiStart; resume?: AiSession }) {
  const y = useYt();
  // every answered turn is kept in the history; a new conversation (run, Cuộc mới, other tickets) gets a new entry
  const [ids, setIds] = useState(initial);
  const sid = useRef(resume?.id ?? "");
  const ai = useAi((req, thread, first) => {
    if (first || !sid.current) sid.current = newSessionId();
    saveSession({ id: sid.current, title, ids: ids.slice(0, AI_MAX), req, thread });
  });
  const ps = useQuery({ queryKey: ["projects"], queryFn: ({ signal }) => api<Project[]>("/projects", { signal }) });
  const notes = useQuery({ queryKey: ["yt", "notes"], queryFn: () => yt.notes(), staleTime: 60_000 });
  const noted = !!notes.data?.[y.mode]?.trim(); // this role's team instructions go into every prompt
  const [prompt, setPrompt] = useState("");
  const [saved, setSaved] = useState(false); // the saved-prompts popup
  // "": no folder, the AI reads the tickets only; remembered per YouTrack project
  const [project, setProjectState] = useState(() => getPref(`ytFolder:${y.project}`) ?? "");
  const setProject = (p: string) => { setProjectState(p); setPref(`ytFolder:${y.project}`, p || null); };
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
  // no tickets (a report, figures): no code to read
  const folder = list.length ? folders.find((p) => p.path === project) : undefined;
  const dir = folder?.path ?? ""; // read-only, the answer streams here

  const one = list.length === 1 ? list[0] : null;
  const { lib } = usePrompts();
  const fits = (b: Builtin) => list.length > 0 && fitsCount(b, list.length > 1);
  function runBuiltin(b: Builtin) {
    const k = b.kind;
    const run = (sig: AbortSignal) =>
      k === "notes" ? yt.aiData("notes", rows.map((r) => ({ id: r.id, type: r.type, summary: r.summary })), sig)
      : k === "summary" || k === "review" ? yt.aiTickets(list, scope, k, sig, "", undefined, 0, [], dir)
      : k === "testcases" ? (one ? yt.aiTickets([one], one, "testcases", sig, "", undefined, 0, [], dir) : yt.aiTickets(list.slice(0, 10), scope, "testcases", sig, "", undefined, 0, [], dir))
      : yt.aiTicket(one!, k, sig, dir);
    setOpenList(false); // the answer gets the room
    void ai.run({ label: `AI: ${b.name.toLowerCase()}`, run });
  }
  /** A built-in runs its job, a saved prompt is sent as the question. */
  function pick(name: string) {
    const b = builtin(name);
    if (b) { if (fits(b)) runBuiltin(b); else toast({ text: `“${name}” cần ${b.for === "one" ? "đúng 1 ticket" : "từ 2 ticket"}` }); return; }
    const p = lib.prompts.find((x) => x.name === name);
    if (p) { setPrompt(p.text); void send(p.text); } // kept in the box if it can't go now
  }
  // the buttons: the team's pick for this role and ticket count (max 5), else the role's default 4
  const chips = !list.length ? [] : shownFor(lib, `${y.mode}:${list.length > 1 ? "many" : "one"}`).filter((n) => { const b = builtin(n); return b ? fits(b) : lib.prompts.some((p) => p.name === n); });
  // the run this session was opened for (once), or the saved answer it shows
  useEffect(() => {
    if (resume) { ai.seed(resume.thread, resume.req); return; }
    if (!auto) return;
    if (auto.seed) { ai.seed([{ q: "", a: auto.seed.text }], auto.seed.req); return; }
    void ai.run(auto).then((r) => { if (r?.text) auto.onDone?.({ text: r.text, req: r.req }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one run per opened session

  async function send(text = prompt) {
    const ask = text.trim();
    if (!ask || busy) return;
    setOpenList(false); // the answer gets the room
    if (ai.canAsk) { setPrompt(""); void ai.ask(ask); return; } // same chat: a follow-up (same folder as its first run)
    if (!list.length) { // a session about figures: the first prompt starts it, then follow-ups
      if (start) { setPrompt(""); void ai.run({ label: start.label, q: ask, run: (sig) => start.ask(ask, sig) }); }
      return;
    }
    setPrompt("");
    void ai.run({ label: dir ? `AI đang đọc ${list.length} ticket và code ${folder!.name}` : `AI đang đọc ${list.length} ticket`, q: ask, run: (sig) => yt.aiTickets(list, scope, "ask", sig, ask, undefined, 0, [], dir) });
  }

  // the AI chat is about one ticket set: changing the set starts a new one
  function change(next: string[]) { if (!busy) { ai.cancel(); setIds(next); } }
  /** Add every ticket ID in the text (one, or many: "VA-1, VA-2"); the ones outside the loaded list are looked up first. */
  async function addIds(text: string) {
    // a bare number is a ticket of the current project: "123" = "VA-123"
    const want = [...new Set((text.toUpperCase().match(TICKET_RE) ?? []).map((t) => (/^\d+$/.test(t) ? `${y.project}-${t}` : t)))].filter((id) => !ids.includes(id));
    if (!want.length) { if (!text.match(TICKET_RE)) toast({ text: `Nhập số ticket (123) hoặc ID (${y.project}-123)` }); setAdd(""); return; }
    setAdd("");
    const unknown = want.filter((id) => !y.rows.some((i) => i.id === id));
    setLooking(true);
    const got = (await Promise.all(unknown.map((id) => yt.detail(id).then((t): Ticket => t, () => null)))).filter((t): t is Ticket => !!t);
    setLooking(false);
    setFound((f) => ({ ...f, ...Object.fromEntries(got.map((t) => [t.id, t])) }));
    const ok = want.filter((id) => !unknown.includes(id) || got.some((t) => t.id === id));
    if (ok.length) change([...new Set([...ids, ...ok])]);
    if (ok.length < want.length) toast({ text: `Không tìm thấy: ${want.filter((id) => !ok.includes(id)).join(", ")}` });
  }

  // chat-like: newest content at the bottom, kept in view as it streams in unless the reader scrolled up
  const { ref: feedRef, onScroll: onFeedScroll } = useFollow(ai.s.status === "busy" ? ai.s.text?.length ?? 0 : 0, `${ai.s.status}:${ai.thread.length}`); // a new turn or answer: back to the bottom
  const chatting = ai.thread.length > 0 || ai.s.status !== "idle";
  const unfolded = openList ?? (!chatting && rows.length <= 4); // auto until toggled: the answer gets the room
  const openOne = (id: string) => y.openTicket(id, list.map((x) => y.rows.find((i) => i.id === x) ?? found[x]).filter((i): i is Ticket => !!i));

  const field = "h-8 rounded-md border border-rule bg-cotton px-2 text-sm";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* the tickets: one slim line (count, the ids, an add box) that never crowds the answer. "N ticket" unfolds the full
          list (id, title, state) within a third of the screen; it folds again when a prompt is sent */}
      <div className="grid shrink-0 rounded-[var(--radius-card)] bg-paper-2/60 shadow-edge">
        <div className="flex h-9 items-center gap-1 px-1">
          {!!rows.length && <Hint side="bottom" text={unfolded ? "Thu gọn danh sách ticket" : "Xem tiêu đề, trạng thái từng ticket"}><button type="button" onClick={() => setOpenList(!unfolded)} aria-expanded={unfolded} aria-controls="work-tickets"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-ink-2 hover:bg-paper-3 hover:text-ink">
            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short)", unfolded && "rotate-90")} aria-hidden /><span className="tabular-nums">{rows.length}</span> ticket</button></Hint>}
          <div className="relative min-w-0 flex-1 self-stretch">
            <AnimatePresence initial={false}>
              {!unfolded && (
                <motion.div key="chips" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: calm ? 0 : 0.15 }}
                  className="no-scrollbar absolute inset-0 flex items-center gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] pr-6">
                  {rows.map((r) => (
                    <span key={r.id} className={cn("inline-flex h-6 shrink-0 items-center rounded-full bg-cotton pl-2 font-mono text-xs shadow-edge", ids.length > 1 ? "pr-0.5" : "pr-2")}>
                      <Hint side="bottom" text={r.summary ?? r.id}><button type="button" onClick={() => openOne(r.id)} className="hover:text-hl-2">{r.id}</button></Hint>
                      {ids.length > 1 && <button type="button" disabled={busy} onClick={() => change(ids.filter((x) => x !== r.id))} aria-label={`Bỏ ${r.id}`}
                        className="ml-0.5 grid size-5 place-items-center rounded-full text-ink-3 hover:bg-paper-3 hover:text-ink"><X className="size-3" /></button>}
                    </span>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <form className="relative shrink-0" onSubmit={(e) => { e.preventDefault(); void addIds(add); }}>
            {/* Enter adds; a suggestion picked (not typed) adds at once; a paste with several numbers / IDs adds them all */}
            <Plus className="pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input list="work-add-ids" value={add} disabled={looking || busy || ids.length >= AI_MAX} maxLength={500} aria-label="Thêm ticket: số hoặc ID, nhiều cái cách dấu phẩy, Enter"
              placeholder={looking ? "Đang tìm…" : "Thêm 123, 456"}
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
              <ul aria-label="Ticket của phiên" className="grid max-h-[min(14rem,30dvh)] gap-px overflow-y-auto border-t border-rule/70 p-1">
                {rows.map((r) => (
                  <li key={r.id} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-md hover:bg-cotton">
                    <button type="button" onClick={() => openOne(r.id)} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 px-1.5 py-1 text-left text-sm">
                      <b className="font-mono text-xs font-medium text-ink-2">{r.id}</b><span className="truncate">{r.summary ?? "—"}</span>{r.state && <StatePill state={r.state} />}
                    </button>
                    {ids.length > 1 && <Button type="button" size="icon-xs" variant="ghost" disabled={busy} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => change(ids.filter((x) => x !== r.id))} aria-label={`Bỏ ${r.id}`}><X /></Button>}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
        {ids.length > AI_MAX && <p className="border-t border-rule/70 px-2 py-1 text-xs text-warn">Chỉ đọc {AI_MAX} / {ids.length} ticket đầu.</p>}
      </div>

      <div ref={feedRef} onScroll={onFeedScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" aria-live="polite">
        {!chatting && (
          <p className="m-auto max-w-sm text-center text-sm text-ink-3">
            <Sparkles className="mx-auto mb-2 size-5 text-hl-2" />
            {start && !list.length ? <>Hỏi AI về “{title.replace(/^AI · /, "")}”: số liệu đang nói gì, bất thường, nguyên nhân, việc nên làm… Nhập câu hỏi rồi Enter.</>
              : <>Hỏi bất kỳ điều gì về {list.length} ticket ở trên, hoặc chọn một gợi ý bên dưới. Chọn thư mục dự án để AI đọc code.</>}
          </p>
        )}
        <AiBox ai={ai} stop={false} onUse={one && !y.config?.mock ? (text) => y.setSheet({ kind: "ticket", id: one, nav: [], comment: text }) : undefined} />
      </div>

      <div className="grid shrink-0 gap-1.5">
        <AiPromptBox aria-label="Yêu cầu cho AI về các ticket đã chọn" autoFocus maxLength={2000} value={prompt} onChange={setPrompt} onSend={() => void send()}
          running={busy} onStop={ai.stop} stopLabel="Hủy"
          placeholder={ai.canAsk ? "Hỏi tiếp…" : start && !list.length ? "Hỏi về số liệu này (Enter gửi, Shift+Enter xuống dòng)" : "Hỏi về các ticket này: phụ thuộc, thứ tự làm, ước lượng, rủi ro, test case… (Enter gửi, Shift+Enter xuống dòng)"}
          top={
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((n) => {
                const b = builtin(n);
                return (
                  <Hint key={n} side="bottom" title={n} text={(b?.hint ?? lib.prompts.find((p) => p.name === n)?.text ?? "").slice(0, 240)}><button type="button" disabled={busy} onClick={() => pick(n)}
                    className="inline-flex h-7 max-w-52 items-center gap-1.5 rounded-full bg-paper-2 px-2.5 text-xs font-medium text-ink-2 ring-1 ring-rule transition-colors duration-(--dur-micro) hover:bg-hl-wash hover:text-hl-2 hover:ring-hl/40 disabled:pointer-events-none disabled:opacity-50">
                    {b ? <Sparkles className="size-3.5 shrink-0 opacity-70" /> : <MessageSquareText className="size-3.5 shrink-0 opacity-70" />}<span className="truncate">{n}</span>
                  </button></Hint>
                );
              })}
              <Hint side="bottom" text="Mở kho prompt: chạy, ghim, thêm, sửa, xóa"><button type="button" onClick={() => setSaved(true)}
                className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium border border-dashed border-rule-2 text-ink-3 transition-colors duration-(--dur-micro) hover:border-ink-3 hover:text-ink">
                <LibraryBig className="size-3.5" />{chips.length ? "Kho prompt" : "Kho prompt: chọn hoặc ghim prompt"}
              </button></Hint>
              {noted && <Hint side="bottom" title="Instructions của team" text={notes.data![y.mode].slice(0, 300)}><span className="ml-auto rounded-full bg-hl-wash px-2 text-xs leading-5 font-medium text-hl-2">Có instructions {({ dev: "Dev", qa: "QC", po: "PO" })[y.mode]}</span></Hint>}
              {chatting && <Hint side="bottom" text="Bắt đầu cuộc trò chuyện mới với các ticket này"><Button type="button" size="xs" variant="ghost" className={noted ? "" : "ml-auto"} disabled={busy} onClick={ai.cancel}><RotateCcw /> Cuộc mới</Button></Hint>}
            </div>
          }
          tools={!!list.length && <label className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3"><FolderSearch className="size-3.5 shrink-0" />
            <select className={`${field} min-w-0 max-w-56`} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Thư mục code để trace">
              <option value="">Không đọc code</option>
              {folders.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}
            </select>
          </label>}
          actions={<>
            {/* A follow-up runs like the first request; a new one is heavy with code or over 10 tickets (as the server decides). */}
            <YtPicks heavy={ai.canAsk ? ai.heavy : !!project || list.length > 10} />
            {!busy && <Button type="button" size="icon-sm" aria-label="Gửi" onClick={() => void send()} disabled={!prompt.trim() || (!list.length && !ai.canAsk && !folder && !start)}
              className="rounded-full bg-hl text-hl-ink hover:brightness-110 animate-in zoom-in-95 fade-in-0 duration-(--dur-short)"><ArrowUp /></Button>}
          </>} />
        {!!list.length && !ps.isPending && !folders.length && <p className="px-1 text-xs text-ink-3">Muốn trace code: thêm thư mục dự án ở Telegram › AI Agent.</p>}
        {folder && <p className="px-1 text-xs text-ink-2">Gợi ý và câu hỏi sẽ đọc code trong {folder.name} (chỉ đọc), trả lời ngay ở trên; chậm hơn, thường 1–3 phút.</p>}
      </div>
      <PromptsDialog open={saved} onOpenChange={setSaved} onPick={pick} role={y.mode} many={list.length > 1} />
    </div>
  );
}
