"use client";

import { useQuery } from "@tanstack/react-query";
import { FolderSearch, LibraryBig, MessageSquareText, Plus, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, type Project } from "@/lib/api";
import { toast } from "@/lib/inbox";
import { getPref, setPref } from "@/lib/prefs";
import { AI_MAX, yt } from "@/lib/yt";
import { AiBox, StatePill, useAi } from "./bits";
import { type AiSession, newSessionId, saveSession } from "./history";
import { type AiAuto, type AiStart, useYt } from "./state";
import { type Builtin, builtin, fitsCount, PromptsDialog, shownFor, usePrompts } from "./prompts";

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
  const list = ids.slice(0, AI_MAX);
  const rows = list.map((id) => y.rows.find((i) => i.id === id) ?? { id, summary: null, state: null, type: null });
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
  function addTicket() {
    const id = add.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(id)) { toast({ text: "ID ticket dạng ABC-123" }); return; }
    if (!ids.includes(id)) change([...ids, id]);
    setAdd("");
  }

  // chat-like: newest content at the bottom, kept in view as it streams in
  const box = useRef<HTMLDivElement>(null);
  const streamed = ai.s.status === "busy" ? ai.s.text?.length ?? 0 : 0;
  const bottom = (force: boolean) => { const el = box.current; if (el && (force || el.scrollHeight - el.scrollTop - el.clientHeight < 400)) el.scrollTop = el.scrollHeight; };
  useEffect(() => bottom(true), [ai.s.status, ai.thread.length]);
  useEffect(() => bottom(false), [streamed]); // while streaming: follow only if the reader has not scrolled up
  const chatting = ai.thread.length > 0 || ai.s.status !== "idle";

  const field = "h-8 rounded-md border border-rule bg-cotton px-2 text-sm";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {ids.length > AI_MAX && <p className="text-xs text-warn">Chỉ đọc {AI_MAX} / {ids.length} ticket đầu.</p>}
      <div className="grid shrink-0 gap-1">
        {!!rows.length && <blockquote className="grid max-h-40 gap-0.5 overflow-y-auto border-l-2 border-hl/50 pl-3" aria-label="Ticket đã chọn">
          {rows.map((r) => (
            <div key={r.id} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center rounded hover:bg-paper-2">
              <button type="button" onClick={() => y.openTicket(r.id, list.map((id) => y.rows.find((i) => i.id === id)!).filter(Boolean))}
                className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1 text-left text-sm">
                <b className="font-mono text-xs">{r.id}</b><span className="truncate text-ink-2">{r.summary}</span>{r.state && <StatePill state={r.state} />}
              </button>
              {ids.length > 1 && <Button type="button" size="icon-xs" variant="ghost" disabled={busy} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => change(ids.filter((x) => x !== r.id))} aria-label={`Bỏ ${r.id}`} title={`Bỏ ${r.id}`}><X /></Button>}
            </div>
          ))}
        </blockquote>}
        <form className="flex items-center gap-1.5 pl-3" onSubmit={(e) => { e.preventDefault(); addTicket(); }}>
          <input list="work-add-ids" value={add} onChange={(e) => setAdd(e.target.value)} maxLength={40} aria-label="Thêm ticket theo ID" placeholder="Thêm ticket: ABC-123"
            className="h-7 w-44 rounded-md border border-rule bg-cotton px-2 font-mono text-xs" />
          <datalist id="work-add-ids">{y.rows.filter((i) => !ids.includes(i.id)).slice(0, 500).map((i) => <option key={i.id} value={i.id}>{i.summary}</option>)}</datalist>
          <Button type="submit" size="icon-xs" variant="ghost" disabled={!add.trim() || busy || ids.length >= AI_MAX} aria-label="Thêm ticket" title="Thêm ticket"><Plus /></Button>
        </form>
      </div>

      <div ref={box} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" aria-live="polite">
        {!chatting && (
          <p className="m-auto max-w-sm text-center text-sm text-ink-3">
            <Sparkles className="mx-auto mb-2 size-5 text-hl-2" />
            {start && !list.length ? <>Hỏi AI về “{title.replace(/^AI · /, "")}”: số liệu đang nói gì, bất thường, nguyên nhân, việc nên làm… Nhập câu hỏi rồi Enter.</>
              : <>Hỏi bất kỳ điều gì về {list.length} ticket ở trên, hoặc chọn một gợi ý bên dưới. Chọn thư mục dự án để AI đọc code.</>}
          </p>
        )}
        <AiBox ai={ai} ask={false} onUse={one && !y.config?.mock ? (text) => y.setSheet({ kind: "ticket", id: one, nav: [], comment: text }) : undefined} />
      </div>

      <form className="grid shrink-0 gap-2 rounded-lg bg-cotton p-3 shadow-stock" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((n) => {
            const b = builtin(n);
            return (
              <button key={n} type="button" disabled={busy} title={b?.hint ?? lib.prompts.find((p) => p.name === n)?.text} onClick={() => pick(n)}
                className="inline-flex h-7 max-w-52 items-center gap-1.5 rounded-full bg-paper-2 px-2.5 text-xs font-medium text-ink-2 ring-1 ring-rule transition-colors duration-(--dur-micro) hover:bg-hl-wash hover:text-hl-2 hover:ring-hl/40 disabled:pointer-events-none disabled:opacity-50">
                {b ? <Sparkles className="size-3.5 shrink-0 opacity-70" /> : <MessageSquareText className="size-3.5 shrink-0 opacity-70" />}<span className="truncate">{n}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => setSaved(true)} title="Mở kho prompt: chạy, ghim, thêm, sửa, xóa"
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium border border-dashed border-rule-2 text-ink-3 transition-colors duration-(--dur-micro) hover:border-ink-3 hover:text-ink">
            <LibraryBig className="size-3.5" />{chips.length ? "Kho prompt" : "Kho prompt: chọn hoặc ghim prompt"}
          </button>
          {noted && <span className="ml-auto rounded-full bg-hl-wash px-2 text-xs leading-5 font-medium text-hl-2" title={notes.data![y.mode]}>Có instructions {({ dev: "Dev", qa: "QC", po: "PO" })[y.mode]}</span>}
          {chatting && <Button type="button" size="xs" variant="ghost" className={noted ? "" : "ml-auto"} disabled={busy} onClick={ai.cancel} title="Bắt đầu cuộc trò chuyện mới với các ticket này"><RotateCcw /> Cuộc mới</Button>}
        </div>
        <Textarea rows={2} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Yêu cầu cho AI về các ticket đã chọn" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          className="max-h-48 resize-none"
          placeholder={ai.canAsk ? "Hỏi tiếp…" : start && !list.length ? "Hỏi về số liệu này (Enter gửi, Shift+Enter xuống dòng)" : "Hỏi về các ticket này: phụ thuộc, thứ tự làm, ước lượng, rủi ro, test case… (Enter gửi, Shift+Enter xuống dòng)"} />
        <div className="flex flex-wrap items-center gap-2">
          {!!list.length && <label className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3"><FolderSearch className="size-3.5 shrink-0" />
            <select className={`${field} min-w-0 max-w-56`} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Thư mục code để trace">
              <option value="">Không đọc code</option>
              {folders.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}
            </select>
          </label>}
          <Button type="submit" size="sm" className="ml-auto" disabled={!prompt.trim() || busy || (!list.length && !ai.canAsk && !folder && !start)} aria-busy={busy}>
            <Send /> Gửi
          </Button>
        </div>
        {!!list.length && !ps.isPending && !folders.length && <p className="text-xs text-ink-3">Muốn trace code: thêm thư mục dự án ở Telegram › AI Agent.</p>}
        {folder && <p className="text-xs text-ink-2">Gợi ý và câu hỏi sẽ đọc code trong {folder.name} (chỉ đọc), trả lời ngay ở trên; chậm hơn, thường 1–3 phút.</p>}
      </form>
      <PromptsDialog open={saved} onOpenChange={setSaved} onPick={pick} role={y.mode} many={list.length > 1} />
    </div>
  );
}
