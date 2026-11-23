"use client";

import { ArrowUp, History, MessageSquarePlus, RotateCw, ScrollText, X } from "lucide-react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ModelEffortPicker } from "@/shared/components/ai";
import { AiBot, AiPromptBox, AiResultCard, AiThinking, UserBubble, useFollow } from "@/shared/components/ai/chat";
import { Markdown } from "@/shared/components/markdown";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { errorText } from "@/shared/lib/api";
import { fmtDate, fmtNum, t as tr, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";
import { type DocAiSession, type DocCite, type DocDetail, type DocFilter, docDetailQuery, docErrors, docs, docSearchQuery } from "@/features/docs/lib/docs";
import { AiHistory } from "./ai-history";

// Tài liệu's AI popup, dropping from the reader's top right over the text, opened from the reader's AI chip (or, with no
// document open, from the empty reader's "Hỏi AI"): Hỏi on the open document (none open: over the search / every
// document), and Tóm tắt for the open document. Answers stack in its feed above the prompt box pinned at its foot; an
// answer's [n] opens its part in the reader under it, or its message. Esc / × closes it (never while a run goes); the
// conversation stays. Every answer and summary the AI writes is kept on the server by conversation (`session`): Lịch sử
// loads one back with no AI run, and a question already answered on this version of the open document comes back
// saved, with "Hỏi lại AI" to run it anyway.

/** What one Hỏi reads at most (DOC_ASK_CHARS in backend docs/ask.py): said above the box for a long document. */
const DOC_ASK_CHARS = 12_000;

// saved: a saved answer given back (its date), with "Hỏi lại AI" (`question`); from history: loaded from Lịch sử
type Turn = {
  id: number; ask: string; wait: string; text: string; busy: boolean; quiet?: boolean; title?: string; cites?: DocCite[]; error?: string;
  saved?: string; question?: string;
};
const newSession = () => crypto.randomUUID().replaceAll("-", "");

/** "[1]", "[2, 3]" → links "#cite:n" for the numbers the answer's `cites` has; any other number stays text. */
function citeLinks(text: string, cites: DocCite[]) {
  const known = new Set(cites.map((c) => c.n));
  return text.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (all, list: string) => {
    const ns = list.split(",").map((x) => Number(x.trim()));
    return ns.every((n) => known.has(n)) ? ns.map((n) => `[${n}](#cite:${n})`).join("") : all;
  });
}

function Cite({ c, onOpen }: { c: DocCite; onOpen: (doc: number, part: number | null) => void }) {
  const t = useT();
  const cls = "mx-0.5 inline-block rounded-sm bg-hl-wash px-1 align-baseline font-mono text-xs text-hl-2 no-underline transition-colors duration-(--dur-micro) hover:bg-hl hover:text-hl-ink";
  if (c.doc != null) return (
    <Hint text={t("Mở đoạn này trong tài liệu")}>
      <button type="button" className={cls} onClick={() => onOpen(c.doc!, c.part ?? null)}>[{c.n}]</button>
    </Hint>
  );
  if (c.chat_id && c.message_id != null) return (
    <Hint text={t("Mở tin này trong nhóm Telegram")}>
      <Link className={cls} href={`/?chat=${encodeURIComponent(c.chat_id)}&msg=${c.message_id}`}>[{c.n}]</Link>
    </Hint>
  );
  return <>[{c.n}]</>;
}

function Answer({ text, cites, onOpen }: { text: string; cites?: DocCite[]; onOpen: (doc: number, part: number | null) => void }) {
  const md = useMemo(() => (cites ? citeLinks(text, cites) : text), [text, cites]);
  const anchor = useCallback((h: string): ReactNode => {
    const c = h.startsWith("cite:") ? cites?.find((x) => x.n === Number(h.slice(5))) : undefined;
    return c ? <Cite c={c} onOpen={onOpen} /> : null;
  }, [cites, onOpen]);
  return <Markdown text={md} anchor={anchor} className="text-ink" />;
}

export function DocAsk({ q, f, onOpen, open, onClose }: {
  q: string; f: DocFilter; onOpen: (doc: number, part: number | null) => void; open: boolean; onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [session, setSession] = useState(newSession);
  const [view, setView] = useState<"chat" | "history">("chat");
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // Opens and closes as the Biết tuốt bot (guide.tsx Bot): grows out of the AI chip that opened it with a spring, shrinks
  // back into it. Kept mounted (the conversation stays): `shown` holds it on screen until the closing animation ends.
  const still = useReducedMotion();
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useLayoutEffect(() => {
    const el = panel.current, chip = el?.parentElement?.querySelector(".ai-chip")?.getBoundingClientRect();
    if (!open || !el || !chip) return;
    const box = el.getBoundingClientRect();
    el.style.transformOrigin = `${chip.left + chip.width / 2 - box.left}px ${chip.top + chip.height / 2 - box.top}px`;
  }, [open]);
  // closed: the hidden box gives up focus, so the next Esc reaches the page (it closes the document)
  useEffect(() => {
    if (open) panel.current?.querySelector("textarea")?.focus();
    else if (document.activeElement instanceof HTMLElement && panel.current?.contains(document.activeElement)) document.activeElement.blur();
  }, [open]);
  const last = turns.at(-1);
  const busy = !!last?.busy;
  const { ref: feedRef, onScroll } = useFollow(last?.text, turns.length);

  // A document open: the whole of it (the parts matching the question first, up to the server's cap). None open: with a
  // search typed, the parts the list shows (the count it sends, before the run); without, the server searches the
  // question's own words.
  const onDoc = f.doc != null;
  const scope = { ...f, doc: null };
  const found = useQuery({ ...docSearchQuery(q, scope), enabled: !!q && !onDoc && open });
  const fresh = found.data && !found.isPlaceholderData ? found.data : undefined;
  const noMatch = onDoc ? false : q ? fresh?.ask_parts === 0 : f.source === "telegram"; // messages: a typed search only
  // the count shown is what gets sent: no run until the new search's count is in (not the last one kept on screen)
  const blocked = noMatch || (!onDoc && !!q && !fresh);
  const detail = useQuery({ ...docDetailQuery(f.doc ?? 0), enabled: f.doc != null });
  const openDoc = f.doc != null ? detail.data : undefined;

  async function run(ask: string, wait: string, call: (signal: AbortSignal, onPart: (s: string) => void) => Promise<Partial<Turn>>, quiet = false) {
    const ctl = (abort.current = new AbortController());
    const id = ++seq.current;
    const set = (x: Partial<Turn>) => setTurns((all) => all.map((u) => (u.id === id ? { ...u, ...x } : u)));
    setTurns((all) => [...all, { id, ask, wait, text: "", busy: true, quiet }]);
    try {
      set({ ...(await call(ctl.signal, (s) => set({ text: s }))), busy: false });
      void qc.invalidateQueries({ queryKey: ["docs", "ai"] }); // the turn is in the history now
    } catch (e) {
      set({ busy: false, error: ctl.signal.aborted ? tr("Đã dừng.") : errorText(e, docErrors(), tr("AI không trả lời được.")) });
    }
  }

  /** `fresh`: run the AI even when this question on the open document has a saved answer. */
  function send(question: string, fresh = false) {
    if (!question || busy || blocked) return;
    const body = onDoc ? { question, q: "", source: null, ticket: null, doc: f.doc, session, fresh }
      : { question, q, source: f.source === "all" ? null : f.source, ticket: f.ticket, doc: null, session, fresh: false };
    void run(question, onDoc ? t("AI đang đọc tài liệu") : t("AI đang đọc các đoạn tài liệu"), async (signal, onPart) => {
      const r = await docs.ask(body, signal, onPart);
      return { text: r.text, cites: r.cites, question, saved: r.saved_at ?? undefined };
    });
  }
  function ask() {
    const question = text.trim();
    if (!question || busy || blocked) return;
    setText("");
    send(question);
  }

  // Lịch sử: a past conversation loaded back as it was (no AI run); new questions carry on in it
  const load = useMutation({
    mutationFn: (s: DocAiSession) => docs.aiTurns(s.session),
    onSuccess: (rows, s) => {
      setTurns(rows.map((r) => ({
        id: ++seq.current, wait: "", busy: false, text: r.text, cites: r.cites,
        ask: r.kind === "summary" ? t("Tóm tắt “{title}”", { title: r.doc_title }) : r.question,
        title: [r.kind === "summary" ? t("Tóm tắt") : t("Trả lời"), fmtDate(r.at, { dateStyle: "short", timeStyle: "short" }),
          r.stale && t("tài liệu đã đổi")].filter(Boolean).join(" · "),
      })));
      setSession(s.session);
      setView("chat");
    },
    onError: (e) => toast({ text: errorText(e, docErrors()) }),
  });

  function summarise(d: DocDetail) {
    if (busy) return;
    const id = d.doc.id;
    // a summary still matching the doc comes back from the server at once: no waiting scene for it
    void run(t("Tóm tắt “{title}”", { title: d.doc.title || d.doc.ref }), t("AI đang đọc cả tài liệu"), async (signal, onPart) => {
      const r = await docs.summary(id, session, signal, onPart);
      qc.setQueryData<DocDetail>(docDetailQuery(id).queryKey, (x) => x && { ...x, summary: r.text, doc: { ...x.doc, has_summary: true } });
      return { text: r.text, title: r.cached ? tr("Tóm tắt đã lưu") : tr("Tóm tắt") };
    }, d.summary != null);
  }

  const top = onDoc ? (openDoc && <span>{openDoc.doc.chars > DOC_ASK_CHARS
      ? t("AI đọc tài liệu này: đoạn khớp câu hỏi trước, tối đa ~{n} ký tự", { n: fmtNum(DOC_ASK_CHARS) })
      : t("AI đọc cả tài liệu này (~{n} ký tự)", { n: fmtNum(openDoc.doc.chars) })}</span>)
    : !q ? <span>{f.source === "telegram" ? t("Gõ từ khóa để tìm trong tin Telegram") : t("Chưa gõ từ tìm: AI tìm đoạn theo từ của câu hỏi")}</span>
    : found.isError ? <span className="text-error">{errorText(found.error, docErrors())}</span>
    : !fresh ? <span>{t("Đang đếm đoạn sẽ gửi…")}</span>
    : fresh.ask_parts === 0 ? <span className="text-warn">{t("Chưa có đoạn nào khớp")}</span>
    : <span>{t("Hỏi trên {n} đoạn đang hiện (~{k} ký tự)", { n: fmtNum(fresh.ask_parts), k: fmtNum(fresh.ask_chars) })}</span>;

  // A popup over the reader's top right, opening at its full height so a long answer has room from the
  // start; bottom-20 keeps its foot (the Hỏi button) above the floating Biết tuốt bot in the screen's corner.
  // Kept mounted while closed: the conversation stays for the next open.
  return (
    <motion.aside ref={panel} data-doc-ask aria-label={t("Hỏi AI")} inert={!open}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (!busy) onClose(); } }}
      initial={false} animate={open ? "open" : "shut"} variants={still ? FADE : GROW} onAnimationComplete={() => { if (!open) setShown(false); }}
      className={cn("absolute top-14 right-3 bottom-20 z-30 flex w-[28rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border bg-paper-2 shadow-pop",
        !shown && "hidden")}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <AiBot className="size-6 shrink-0" />
        {/* what it asks over: the open document, else the search / every document (no switch: closing the document widens it) */}
        <h2 className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-medium text-ink">{t("Hỏi AI")}</span>
          <span className="truncate text-2xs text-ink-3">{onDoc ? openDoc?.doc.title || openDoc?.doc.ref : q ? t("Kết quả tìm") : t("Mọi tài liệu")}</span>
        </h2>
        {turns.length > 0 && !busy && (
          <Hint text={t("Phiên mới: hội thoại này vẫn nằm trong Lịch sử")}>
            <Button size="icon-xs" variant="ghost" aria-label={t("Phiên hỏi mới")}
              onClick={() => { setTurns([]); setSession(newSession()); setView("chat"); }}><MessageSquarePlus /></Button>
          </Hint>
        )}
        <Hint text={t("Lịch sử hỏi và tóm tắt: xem lại không tốn token")}>
          <Button size="icon-xs" variant="ghost" aria-label={t("Lịch sử hỏi AI")} aria-pressed={view === "history"} disabled={busy}
            className={cn(view === "history" && "bg-hl-wash text-hl-2")} onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}>
            <History />
          </Button>
        </Hint>
        <Hint text={t("Đóng (Esc); hội thoại vẫn giữ")}>
          <Button size="icon-sm" variant="ghost" aria-label={t("Đóng panel hỏi AI")} onClick={onClose}><X /></Button>
        </Hint>
      </header>
      {view === "history" ? (
        <div className="min-h-0 flex-auto overflow-y-auto" aria-busy={load.isPending}>
          <AiHistory doc={f.doc} current={session} onPick={(s) => load.mutate(s)} />
        </div>
      ) : <>
      <div ref={feedRef} onScroll={onScroll} aria-live="polite" className="grid min-h-0 flex-auto grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <div className="grid justify-items-center gap-1.5 px-4 py-2 text-center">
            <AiBot className="size-10" />
            <p className="text-sm font-medium text-ink">{onDoc ? t("Hỏi về tài liệu này") : t("Hỏi trên tài liệu")}</p>
            <p className="text-xs leading-relaxed text-ink-3">{t("AI trả lời kèm nguồn [1], [2]: bấm số để mở đúng đoạn trong tài liệu.")}</p>
          </div>
        ) : turns.map((u) => (
          <div key={u.id} className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <UserBubble>{u.ask}</UserBubble>
            {u.error ? <AiResultCard error>{u.error}</AiResultCard>
              : u.busy && !u.text ? (u.quiet ? null : <AiThinking label={u.wait} />)
              : (
                <AiResultCard busy={u.busy} dim={u !== last}
                  title={u.saved ? t("Câu trả lời đã lưu · {when}", { when: fmtDate(u.saved, { dateStyle: "short", timeStyle: "short" }) }) : u.title ?? t("Trả lời")}
                  actions={u.saved && u.question && !busy && (
                    <Hint text={t("Đã hỏi câu này trên đúng bản tài liệu này nên hiện lại, không tốn token. Bấm để AI trả lời lại.")}>
                      <Button size="xs" variant="outline" className="rounded-full" onClick={() => send(u.question!, true)}><RotateCw />{t("Hỏi lại AI")}</Button>
                    </Hint>
                  )}>
                  <Answer text={u.text} cites={u.cites} onOpen={onOpen} />
                </AiResultCard>
              )}
          </div>
        ))}
      </div>
      <div className="shrink-0 px-3 pb-3">
        <AiPromptBox value={text} onChange={setText} onSend={ask} running={busy} onStop={() => abort.current?.abort()}
          aria-label={t("Hỏi AI trên tài liệu")} maxLength={2000}
          placeholder={onDoc ? t("Hỏi về tài liệu này…") : t("Hỏi về các đoạn đang hiện…")}
          top={top && <p className="text-xs text-ink-3">{top}</p>}
          // Hỏi and Tóm tắt are "Tóm tắt, soạn nháp" runs: the same saved picks as Settings › AI
          tools={<ModelEffortPicker kind="chat" compact className="gap-x-2 text-xs" />}
          actions={!busy && <>
            {onDoc && openDoc && <SummaryChip d={openDoc} onRun={() => summarise(openDoc)} />}
            <Hint text={noMatch ? t("Chưa có đoạn nào khớp để hỏi") : t("Gửi câu hỏi (Enter, Shift+Enter xuống dòng)")}>
              <Button size="sm" className="rounded-full bg-hl" disabled={!text.trim() || blocked} onClick={ask} aria-label={t("Hỏi")}>
                <ArrowUp />{t("Hỏi")}
              </Button>
            </Hint>
          </>} />
      </div>
      </>}
    </motion.aside>
  );
}

// the Biết tuốt bot's open / close (guide.tsx): spring in from half size, a quick ease out
const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
const OUT = { duration: 0.2, ease: [0.4, 0, 1, 1] as const };
const GROW = {
  open: { opacity: 1, scale: 1, transition: { scale: SPRING, opacity: { duration: 0.16 } } },
  shut: { opacity: 0, scale: 0.5, transition: OUT },
};
const FADE = { open: { opacity: 1 }, shut: { opacity: 0 } };

/** Tóm tắt for the open document, in the prompt box (its size in the hint). */
function SummaryChip({ d, onRun }: { d: DocDetail; onRun: () => void }) {
  const t = useT();
  return (
    <Hint text={d.summary != null ? t("Đã có bản tóm tắt khớp tài liệu này: hiện ngay, không chạy AI.")
      : t("AI đọc cả tài liệu đang mở ({n} ký tự) và tóm tắt; lần sau hiện lại bản đã lưu nếu tài liệu chưa đổi.", { n: fmtNum(d.doc.chars) })}>
      <Button size="sm" variant="outline" className="rounded-full" onClick={onRun} aria-label={t("Tóm tắt tài liệu này")}>
        <ScrollText />{t("Tóm tắt")}
      </Button>
    </Hint>
  );
}
