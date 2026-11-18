"use client";

import { ArrowUp, ScrollText, Trash2 } from "lucide-react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelEffortPicker } from "@/shared/components/ai";
import { AiPromptBox, AiResultCard, AiThinking, UserBubble, useFollow } from "@/shared/components/ai/chat";
import { Markdown } from "@/shared/components/markdown";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { errorText } from "@/shared/lib/api";
import { fmtNum, t as tr, useT } from "@/shared/lib/i18n";
import { type DocCite, type DocDetail, type DocFilter, docDetailQuery, docErrors, docs, docSearchQuery } from "@/features/docs/lib/docs";

// Tài liệu's AI box, pinned under the screen: Hỏi over what the search shows (the count it sends, before the run), and
// Tóm tắt for the open document. Answers stack in a feed above the box; an answer's [n] opens its part or message.

type Turn = { id: number; ask: string; wait: string; text: string; busy: boolean; quiet?: boolean; title?: string; cites?: DocCite[]; error?: string };

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

export function DocAsk({ q, f, onOpen }: { q: string; f: DocFilter; onOpen: (doc: number, part: number | null) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  useEffect(() => () => abort.current?.abort(), []);
  const last = turns.at(-1);
  const busy = !!last?.busy;
  const { ref: feedRef, onScroll } = useFollow(last?.text, turns.length);

  // with a search typed, Hỏi reads the parts the list shows (every document, as the list); without, the server
  // searches the question's own words (in the open document when one is open), so there is no count to show yet
  const scope = q ? { ...f, doc: null } : f;
  const found = useQuery({ ...docSearchQuery(q, scope), enabled: !!q });
  const fresh = found.data && !found.isPlaceholderData ? found.data : undefined;
  const noMatch = q ? fresh?.ask_parts === 0 : f.source === "telegram"; // messages are found by a typed search only
  // the count shown is what gets sent: no run until the new search's count is in (not the last one kept on screen)
  const blocked = noMatch || (!!q && !fresh);
  const detail = useQuery({ ...docDetailQuery(f.doc ?? 0), enabled: f.doc != null });
  const open = f.doc != null ? detail.data : undefined;

  async function run(ask: string, wait: string, call: (signal: AbortSignal, onPart: (s: string) => void) => Promise<Partial<Turn>>, quiet = false) {
    const ctl = (abort.current = new AbortController());
    const id = ++seq.current;
    const set = (x: Partial<Turn>) => setTurns((all) => all.map((u) => (u.id === id ? { ...u, ...x } : u)));
    setTurns((all) => [...all, { id, ask, wait, text: "", busy: true, quiet }]);
    try {
      set({ ...(await call(ctl.signal, (s) => set({ text: s }))), busy: false });
    } catch (e) {
      set({ busy: false, error: ctl.signal.aborted ? tr("Đã dừng.") : errorText(e, docErrors(), tr("AI không trả lời được.")) });
    }
  }

  function ask() {
    const question = text.trim();
    if (!question || busy || blocked) return;
    setText("");
    const body = { question, q, source: f.source === "all" ? null : f.source, ticket: f.ticket, doc: scope.doc };
    void run(question, t("AI đang đọc các đoạn tài liệu"), async (signal, onPart) => {
      const r = await docs.ask(body, signal, onPart);
      return { text: r.text, cites: r.cites };
    });
  }

  function summarise(d: DocDetail) {
    if (busy) return;
    const id = d.doc.id;
    // a summary still matching the doc comes back from the server at once: no waiting scene for it
    void run(t("Tóm tắt “{title}”", { title: d.doc.title || d.doc.ref }), t("AI đang đọc cả tài liệu"), async (signal, onPart) => {
      const r = await docs.summary(id, signal, onPart);
      qc.setQueryData<DocDetail>(docDetailQuery(id).queryKey, (x) => x && { ...x, summary: r.text, doc: { ...x.doc, has_summary: true } });
      return { text: r.text, title: r.cached ? tr("Tóm tắt đã lưu") : tr("Tóm tắt") };
    }, d.summary != null);
  }

  const top = !q ? <span>{f.source === "telegram" ? t("Gõ từ khóa để tìm trong tin Telegram")
      : f.doc != null ? t("Chưa gõ từ tìm: AI tìm trong tài liệu đang mở theo từ của câu hỏi") : t("Chưa gõ từ tìm: AI tìm đoạn theo từ của câu hỏi")}</span>
    : found.isError ? <span className="text-error">{errorText(found.error, docErrors())}</span>
    : !fresh ? <span>{t("Đang đếm đoạn sẽ gửi…")}</span>
    : fresh.ask_parts === 0 ? <span className="text-warn">{t("Chưa có đoạn nào khớp")}</span>
    : <span>{t("Hỏi trên {n} đoạn đang hiện (~{k} ký tự)", { n: fmtNum(fresh.ask_parts), k: fmtNum(fresh.ask_chars) })}</span>;

  return (
    // pr-20: under ~1024px the centred box reaches the right edge, where the floating guide bot (≤ 60px + 16px gap) sits
    <div className="shrink-0 border-t bg-paper-2 px-4 py-3 @max-5xl/docs:pr-20">
      {turns.length > 0 && (
        <div ref={feedRef} onScroll={onScroll} aria-live="polite"
          className="mx-auto mb-3 grid max-h-[40dvh] max-w-3xl grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto">
          {turns.map((u) => (
            <div key={u.id} className="grid grid-cols-[minmax(0,1fr)] gap-2">
              <UserBubble>{u.ask}</UserBubble>
              {u.error ? <AiResultCard error>{u.error}</AiResultCard>
                : u.busy && !u.text ? (u.quiet ? null : <AiThinking label={u.wait} />)
                : (
                  <AiResultCard title={u.title ?? t("Trả lời")} busy={u.busy} dim={u !== last}>
                    <Answer text={u.text} cites={u.cites} onOpen={onOpen} />
                  </AiResultCard>
                )}
            </div>
          ))}
        </div>
      )}
      <AiPromptBox value={text} onChange={setText} onSend={ask} running={busy} onStop={() => abort.current?.abort()}
        className="mx-auto max-w-3xl" aria-label={t("Hỏi AI trên tài liệu")} maxLength={2000}
        placeholder={t("Hỏi về các đoạn đang hiện…")}
        top={top && <p className="text-xs text-ink-3">{top}</p>}
        tools={<>
          {/* Hỏi and Tóm tắt are "Tóm tắt, soạn nháp" runs: the same saved picks as Settings › AI */}
          <ModelEffortPicker kind="chat" compact className="gap-x-2 text-xs" />
          {turns.length > 0 && !busy && (
            <Hint text={t("Xóa hội thoại")}>
              <Button size="icon-xs" variant="ghost" aria-label={t("Xóa hội thoại")} onClick={() => setTurns([])}><Trash2 /></Button>
            </Hint>
          )}
        </>}
        actions={!busy && <>
          {open && (
            <Hint text={open.summary != null ? t("Đã có bản tóm tắt khớp tài liệu này: hiện ngay, không chạy AI.")
              : t("AI đọc cả tài liệu đang mở ({n} ký tự) và tóm tắt; lần sau hiện lại bản đã lưu nếu tài liệu chưa đổi.", { n: fmtNum(open.doc.chars) })}>
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => summarise(open)}>
                <ScrollText />{t("Tóm tắt tài liệu này")}
                <span className="text-ink-3 @max-2xl/docs:hidden">{t("{n} ký tự", { n: fmtNum(open.doc.chars) })}</span>
              </Button>
            </Hint>
          )}
          <Hint text={noMatch ? t("Chưa có đoạn nào khớp để hỏi") : t("Hỏi AI trên các đoạn này (Enter, Shift+Enter xuống dòng)")}>
            <Button size="sm" className="rounded-full bg-hl" disabled={!text.trim() || blocked} onClick={ask}>
              <ArrowUp />{t("Hỏi")}
            </Button>
          </Hint>
        </>} />
    </div>
  );
}
