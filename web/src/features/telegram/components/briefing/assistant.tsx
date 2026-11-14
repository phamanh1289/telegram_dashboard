"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ClipboardList, Copy, CornerDownRight, type LucideIcon, MessagesSquare, Send, Sun, Trash2, TriangleAlert, UserRound, X } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelEffortPicker } from "@/shared/components/ai";
import { AiBot, AiPromptBox, AiResultCard, AiThinking, UserBubble, useFollow } from "@/shared/components/ai/chat";
import { ItemActions } from "@/features/telegram/components/digest-page";
import { ASK_BTN, AskPost, Markdown } from "@/shared/components/markdown";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DIALOG_SHEET, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { apiStream, type BriefingItem, errorText } from "@/shared/lib/api";
import { type Brief, saveBrief } from "@/features/telegram/lib/briefs";
import { type Key, t as tr, useT } from "@/shared/lib/i18n";
import { askInQa } from "@/features/telegram/lib/inbox";
import { copyText } from "@/shared/lib/notifications";
import { readIntro } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { briefingQuery, useSaveBriefing } from "@/features/telegram/components/briefing/run";
import { EASE, FADE, NextSteps, tgText } from "@/features/telegram/components/briefing/todo";

// ---- the AI assistant: questions across every group's latest digest ------------------------------------------------

const sessionKey = () => `tg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SUGGEST: [LucideIcon, Key, string][] = [
  [Sun, "Hôm nay làm gì trước?", "Hôm nay tôi cần làm gì trước? Xếp theo độ gấp."],
  [UserRound, "Ai đang chờ tôi?", "Ai đang chờ tôi trả lời hoặc chốt?"],
  [TriangleAlert, "Blocker và rủi ro", "Có blocker hay rủi ro nào cần để ý không?"],
  [ClipboardList, "Cần confirm gì?", "Những câu nào đang chờ tôi confirm hoặc chốt, ở nhóm nào?"],
];
// ---- a Trợ lý answer and its next steps (digest.py ASK): ⟦group:message⟧ sources, asks per group, "Hỏi tiếp" -------

const REF = /\s*⟦(-?\d+)(?::(\d+))?⟧/g;
const NEXT = /^\s*\*\*Hỏi tiếp:?\*\*:?\s*$/m;
const CITED = ["confirmations", "actions", "decisions", "changes", "impacts"] as const;
const NO_GROUPS: BriefingItem[] = [];
const LEAVE = ["open-reply", "open-qa", "open-task"]; // lib/inbox events that open another page

/** An answer split for drawing: `md` with its sources as "#cite:" links (none in a quote; a group's ask label loses its
 *  own), `asks` [group id, line] of the quoted messages under each group's label, `next` the follow-up questions. */
function parseAnswer(text: string) {
  const at = text.search(NEXT);
  const next = at < 0 ? [] : text.slice(at).split("\n").slice(1).flatMap((l) => /^\s*[-*+]\s+(.+)/.exec(l)?.[1].replace(REF, "").trim() || []);
  const lines = (at < 0 ? text : text.slice(0, at)).trimEnd().split("\n");
  const asks: [string, string][] = [];
  let group: string | null = null;
  const md = lines.map((l, i) => {
    if (/^\s*>/.test(l)) {
      if (group) asks.push([group, l.replace(/^\s*>\s?/, "")]);
      return l.replace(REF, "");
    }
    const label = [...l.matchAll(REF)].find((m) => !m[2]);
    if (label && /^\s*>/.test(lines.slice(i + 1).find((x) => x.trim()) ?? "")) { group = label[1]; return l.replace(REF, ""); }
    if (l.trim()) group = null; // blank lines keep a group's messages together; any other line ends them
    return l.replace(REF, (_, chat: string, msg?: string) => ` [↗](#cite:${chat}${msg ? `:${msg}` : ""})`);
  });
  return { md: md.join("\n"), asks, next };
}
/** The answer as text to copy / send: no sources, no follow-ups. */
const plainAnswer = (text: string) => { const at = text.search(NEXT); return (at < 0 ? text : text.slice(0, at)).replace(REF, "").trimEnd(); };

/** A cited source: its group (the item on hover), then the next step on that item (same buttons as Briefing's rows). */
function Cite({ hash, groups }: { hash: string; groups: BriefingItem[] }) {
  const tx = useT();
  const [, chatId, msg] = hash.split(":");
  const g = groups.find((x) => x.chat_id === chatId);
  if (!g) return null;
  const res = g.saved?.result;
  const hit = msg && res ? CITED.flatMap((k) => (res[k] ?? []).map((it) => [k, it] as const)).find(([, it]) => it.message_ids?.includes(msg)) : undefined;
  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-y-0.5 align-baseline text-xs">
      <Hint side="bottom" text={hit?.[1].text || tx("Nhóm {group}", { group: g.title })}>
        <span className="inline-block max-w-44 truncate rounded-sm bg-paper-3 px-1 align-bottom text-ink-2">{g.title}{msg && ` · #${msg}`}</span>
      </Hint>
      {hit ? <NextSteps chatId={chatId} it={hit[1]} kind={hit[0]} /> : msg && <ItemActions chatId={chatId} ids={[msg]} text="" />}
    </span>
  );
}

/** Next to a quoted ask's copy button: that group's Q&A, the ask pre-filled (tag / edit, then send there). */
function QaAsk({ text, chatId, title }: { text: string; chatId: string; title: string }) {
  const tx = useT();
  return (
    <Hint text={tx("Hỏi trong Q&A của {group}: mở với câu hỏi điền sẵn, tag người được hỏi rồi gửi", { group: title })}>
      <button type="button" aria-label={tx("Hỏi trong Q&A")} onClick={() => askInQa(chatId, text)} className={ASK_BTN}>
        <MessagesSquare className="size-3.5" aria-hidden />
      </button>
    </Hint>
  );
}

function BriefAnswer({ text, groups }: { text: string; groups: BriefingItem[] }) {
  const { md, asks } = useMemo(() => parseAnswer(text), [text]);
  const anchor = useCallback((h: string) => (h.startsWith("cite:") ? <Cite hash={h} groups={groups} /> : null), [groups]);
  const post = useCallback((ask: string) => {
    const first = ask.split("\n").map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim()).find(Boolean);
    const id = first && asks.find(([, l]) => l.includes(first))?.[0];
    const g = id ? groups.find((x) => x.chat_id === id) : undefined;
    return g ? <QaAsk text={ask} chatId={g.chat_id} title={g.title} /> : null;
  }, [asks, groups]);
  return <AskPost value={post}><Markdown asks text={md} anchor={anchor} className="text-ink" /></AskPost>;
}

const askErr = () => ({ briefing_empty: tr("Chưa có bản tóm tắt nào; bấm “Tóm tắt” trước."), ai_not_configured: tr("AI chưa cài hoặc chưa đăng nhập, xem Cài đặt › AI.") });
const THINK: Key[] = ["Đang đọc tóm tắt các nhóm", "Đang tìm việc chờ bạn", "Đang xếp theo độ gấp"];
type Turn = { id: number; q: string; text: string; busy: boolean; error?: string };

/** ⌘J from any Telegram page: the Briefing assistant in a drawer (the same pane as on the Briefing page), so a question
 *  about every group needs no trip to Briefing. Mounted only while open (its portal and its reads). */
export function AiDock({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  useEffect(() => { // an answer's Trả lời / Hỏi trong Q&A opens a page under the drawer: let it show
    if (!open) return;
    const close = () => onOpenChange(false);
    for (const e of LEAVE) addEventListener(e, close);
    return () => { for (const e of LEAVE) removeEventListener(e, close); };
  }, [open, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <DockBody />}
    </Dialog>
  );
}

function DockBody() {
  const tx = useT();
  return (
    <DialogContent className={cn(DIALOG_SHEET, "sm:max-w-md")}>
      <DialogTitle className="sr-only">{tx("Trợ lý AI (⌘J)")}</DialogTitle>
      <BriefAssistant className="h-full lg:border-l-0" />
    </DialogContent>
  );
}

/** The Briefing assistant outside the Briefing page: ⌘J, and AI Agent › Briefing going on with a kept `brief`
 *  (`bare`: that page shows its own title bar). */
export function BriefAssistant({ brief, bare, className }: { brief?: Brief; bare?: boolean; className?: string }) {
  const ready = (useQuery(briefingQuery).data ?? []).some((i) => i.consent && i.saved);
  const save = useSaveBriefing();
  return <AiPane ready={ready} brief={brief} bare={bare} onSave={(t) => save.mutate(t)} saving={save.isPending} className={className} />;
}

export function AiPane({ ready, brief, bare, onSave, saving, onClose, className }: {
  ready: boolean; brief?: Brief; bare?: boolean; onSave: (text: string) => void; saving: boolean; onClose?: () => void; className?: string;
}) {
  const tx = useT();
  const [q, setQ] = useState("");
  // brief: a kept conversation going on (its turns first, new ones saved under the same id)
  const [turns, setTurns] = useState<Turn[]>(() => (brief?.turns ?? []).map((t, i) => ({ id: -1 - i, q: t.q, text: t.a, busy: false })));
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const histId = useRef(brief?.id ?? sessionKey()); // this conversation in AI Agent › Briefing
  const done = useRef<{ q: string; a: string }[]>([...(brief?.turns ?? [])]);
  useEffect(() => () => abort.current?.abort(), []);
  const last = turns.at(-1);
  const busy = !!last?.busy;
  const { ref: feedRef, onScroll } = useFollow(last?.text, turns.length);
  const groups = useQuery(briefingQuery).data ?? NO_GROUPS; // what the answers' sources point at
  const next = last && !busy && !last.error ? parseAnswer(last.text).next : [];

  async function ask(question = q.trim()) {
    if (!question || busy || !ready) return;
    const ctl = (abort.current = new AbortController());
    const id = ++seq.current;
    const set = (t: Partial<Turn>) => setTurns((all) => all.map((x) => (x.id === id ? { ...x, ...t } : x)));
    setQ("");
    setTurns((all) => [...all, { id, q: question, text: "", busy: true }]);
    try {
      const r = await apiStream<{ text: string }>("/briefing/ask", { question, intro: readIntro() }, ctl.signal, (text) => set({ text }));
      set({ text: r.text, busy: false });
      // kept in AI Agent › Briefing, to read again later
      done.current.push({ q: question, a: r.text });
      saveBrief(histId.current, [...done.current]);
    } catch (e) {
      set({ busy: false, error: ctl.signal.aborted ? tr("Đã dừng.") : errorText(e, askErr(), tr("AI không trả lời được.")) });
    }
  }

  return (
    <aside aria-label={tx("Trợ lý AI")} className={cn("flex min-h-0 flex-col bg-paper-2/40 lg:border-l", className)}>
      {!bare && <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <AiBot className="size-6 shrink-0" />
        <span className="text-sm font-bold text-ink">{tx("Trợ lý Briefing")}</span>
        <span className="truncate text-xs text-ink-3">{tx("đọc tóm tắt mọi nhóm")}</span>
        <div className="ml-auto flex items-center">
          {turns.length > 0 && (
            <Hint side="bottom" text={tx("Xóa hội thoại")}>
              <Button size="icon-xs" variant="ghost" aria-label={tx("Xóa hội thoại")} disabled={busy} onClick={() => { setTurns([]); histId.current = sessionKey(); done.current = []; }}><Trash2 /></Button>
            </Hint>
          )}
          {onClose && (
            <Hint side="bottom" text={tx("Ẩn Trợ lý AI (hội thoại vẫn giữ)")}>
              <Button size="icon-xs" variant="ghost" className="max-lg:hidden" aria-label={tx("Ẩn Trợ lý AI")} onClick={onClose}><X /></Button>
            </Hint>
          )}
        </div>
      </div>}
      <div ref={feedRef} onScroll={onScroll} aria-live="polite" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <motion.div {...FADE} className="grid gap-4 pt-2">
            <div className="grid justify-items-center gap-2 text-center">
              <AiBot className="ai-hop size-12 drop-shadow-sm" />
              <p className="text-sm font-bold text-ink">{tx("Hỏi gì về các nhóm cũng được")}</p>
              <p className="max-w-64 text-xs leading-relaxed text-ink-3">
                {ready ? tx("AI đọc bản tóm tắt mới nhất của mọi nhóm, không đọc thêm tin Telegram.") : tx("Tóm tắt ít nhất một nhóm để bắt đầu hỏi.")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SUGGEST.map(([Icon, label, prompt], n) => (
                <motion.button key={label} type="button" disabled={!ready} onClick={() => void ask(prompt)}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.05 * n, duration: 0.24, ease: EASE } }}
                  className="grid gap-1.5 rounded-xl border border-rule bg-cotton p-3 text-left text-xs font-medium text-ink-2 shadow-stock transition-[border-color,color,translate] duration-(--dur-short) ease-(--ease-out) hover:-translate-y-0.5 hover:border-hl/50 hover:text-ink disabled:pointer-events-none disabled:opacity-50">
                  <Icon className="size-4 text-hl" aria-hidden />{tx(label)}
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : turns.map((t) => (
          <div key={t.id} className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <UserBubble>{t.q}</UserBubble>
            {t.error ? <AiResultCard error>{t.error}</AiResultCard>
              : t.busy && !t.text ? <AiThinking lines={THINK.map((l) => tx(l))} />
              : (
                <AiResultCard title={tx("Trả lời")} busy={t.busy} dim={t !== last} actions={!t.busy && <>
                  <Button size="xs" variant="ghost" disabled={saving} onClick={() => onSave(tgText(plainAnswer(t.text)))}><Send /> Saved Messages</Button>
                  <Button size="xs" variant="ghost" onClick={() => void copyText(plainAnswer(t.text), tr("Đã copy"))}><Copy /> Copy</Button>
                </>}>
                  <BriefAnswer text={t.text} groups={groups} />
                </AiResultCard>
              )}
          </div>
        ))}
        {next.length > 0 && (
          <div role="group" aria-label={tx("Hỏi tiếp")} className="flex flex-wrap gap-1.5">
            {next.map((n) => (
              <Hint key={n} text={tx("Điền câu này vào ô hỏi")}>
                <button type="button" onClick={() => setQ(n)}
                  className="inline-flex items-center gap-1 rounded-full border border-rule bg-cotton px-2.5 py-1 text-left text-xs text-ink-2 transition-colors duration-(--dur-micro) hover:border-hl/50 hover:text-ink">
                  <CornerDownRight className="size-3 shrink-0 text-hl" aria-hidden />{n}
                </button>
              </Hint>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 p-3">
        <AiPromptBox value={q} onChange={setQ} onSend={() => void ask()} running={busy} onStop={() => abort.current?.abort()}
          aria-label={tx("Hỏi AI về các nhóm")} maxLength={1000}
          placeholder={ready ? tx("Hỏi về mọi nhóm…") : tx("Tóm tắt một nhóm để hỏi AI")}
          tools={<ModelEffortPicker kind="brief" compact className="gap-x-2 text-xs" />}
          actions={!busy && (
            <Button size="icon-sm" className="rounded-full" aria-label={tx("Gửi câu hỏi")} disabled={!ready || !q.trim()} onClick={() => void ask()}>
              <ArrowUp />
            </Button>
          )} />
      </div>
    </aside>
  );
}
