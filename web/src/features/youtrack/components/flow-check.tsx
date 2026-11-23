"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Code, ExternalLink, Layers, Monitor, Send, Smartphone, Sparkles, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { AiPromptBox, AiResultCard, AiThinking, UserBubble, useFollow } from "@/shared/components/ai/chat";
import { Markdown } from "@/shared/components/markdown";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/dialog";
import { AiFetching } from "@/shared/components/ai/fetching";
import { Hint } from "@/shared/components/ui/hint";
import { fmtNum, type Key, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { type FlowCheck, type FlowTarget, yt } from "@/features/youtrack/lib/yt";
import { AiAsk, YtPicks } from "./bits";
import { OptionCard } from "./flow-option-card";

// Before an AI render: what it will send, counted by code (POST /flow/precheck, no AI). Nothing is cut or refused for
// size: every render asks once in FlowRisks (counted when it opens). The other platform's screens are left out by
// the server from the platform picked (`target`): the count, the warnings and the render all follow the same reads.

const say = (e: unknown) => (e as Error).message;
/** "$0.012" / "<$0.001": a render's estimated price, from past runs on its model. */
export const fmtUsd = (n: number) => (n < 0.001 ? "<$0.001" : "$" + fmtNum(Number(n.toPrecision(2))));
/** "17,2k": a token count, short. */
export const fmtK = (n: number) => (n >= 1000 ? `${fmtNum(Math.round(n / 100) / 10)}k` : fmtNum(n));
const PART: Record<string, Key> = { ticket: "Ticket", story: "Story cha", zeplin: "Chữ Zeplin", note: "Ghi chú", rules: "Luật vẽ" };
/** Screens per part of a split render (flow_prompt.PART_SCREENS). */
const PART_SCREENS = 12;

/** One query per count (the server caches the reads it makes and shares them while in flight, so a render pressed
 *  mid-count waits on the same reads). Another platform counts again; the old numbers stay on until the new ones land. */
export function useFlowCheck(issue: string, enabled: boolean, target: FlowTarget) {
  return useQuery({ queryKey: ["yt", "flow-check", issue, target], queryFn: ({ signal }) => yt.flowCheck(issue, "", target, signal),
    enabled, staleTime: 60_000, retry: false, placeholderData: keepPreviousData });
}

type Line = NonNullable<FlowCheck["risks"][number]["lines"]>[number];
type Turn = { q: string; a?: string; error?: string };
type Target = FlowTarget;
type Mode = "screens" | "split" | "ai";
/** A line's identity across counts: #n shifts when a left-out screen takes its lines, the line itself does not. */
const lineKey = (l: Line) => `${l.why}|${l.line}`;

/** What is wrong with an unclear line and how to fix it in the ticket, in the writer's words. */
function useWhy() {
  const t = useT();
  return (l: Line): [string, string] => {
    switch (l.why) {
      case "unknown": return [t("Màn “{name}” không trùng tên link Zeplin nào trong ticket", { name: l.name }),
        l.hint ? t("đổi thành “{hint}” nếu là cùng màn", { hint: l.hint }) : t("thêm link Zeplin cho màn này, dạng [{name}](link Zeplin), hoặc đổi cho trùng tên một màn đã có", { name: l.name })];
      case "duplicate": return [t("Có nhiều link Zeplin cùng tên “{name}”, không biết là màn nào", { name: l.name }), t("đặt tên các link Zeplin khác nhau")];
      case "label": return [t("Tên nút dài hơn 80 ký tự"), t("rút gọn tên nút trong ngoặc kép")];
      default: return [t("Có mũi tên nhưng sai cú pháp: không đọc được tên nút hoặc màn đích"), t("viết lại: Màn A -- \"Tên nút\" --> Màn B (tên nút trong ngoặc kép)")];
    }
  };
}

// Markdown links [title](url) and bare URLs in a source line: open in the browser, outside the app.
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
function Linked({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    const url = m[2] ?? m[3];
    out.push(text.slice(at, m.index), <a key={m.index} href={url} target="_blank" rel="noopener noreferrer" className="text-hl-2 underline underline-offset-2 hover:text-hl">{m[1] ?? url}</a>);
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

/** One risk group: a header that folds its lines (animated). Each line: a box to leave it out of the render, #n (a
 *  click on the row cites it in the question), what is wrong and how to fix it, and its Zeplin links. */
function Issues({ risk, isOff, onToggle, onSetAll, onCite }: { risk: FlowCheck["risks"][number]; isOff: (l: Line) => boolean; onToggle: (l: Line) => void; onSetAll: (lines: Line[], off: boolean) => void; onCite: (no: number) => void }) {
  const t = useT();
  const why = useWhy();
  const [open, setOpen] = useState(true);
  const lines = risk.lines ?? [];
  const on = lines.filter((l) => !isOff(l)).length;
  return (
    <section className="grid grid-cols-1 gap-2">
      <div className="flex items-start gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left text-sm font-medium text-ink hover:text-hl-2">
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden />
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
        <span className="min-w-0 flex-1">{risk.text}</span>
        <span className="shrink-0 font-mono text-2xs font-normal tabular-nums text-ink-3">{t("vẽ {k}/{n}", { k: on, n: lines.length })}</span>
      </button>
      {lines.length > 1 && (
        <Hint side="bottom" text={on === lines.length ? t("Bỏ chọn mọi dòng trong nhóm này: AI không vẽ chúng") : t("Chọn lại mọi dòng trong nhóm này: AI vẽ hết")}>
          <button type="button" onClick={() => onSetAll(lines, on === lines.length)} className="shrink-0 rounded px-1.5 text-2xs font-medium text-hl-2 hover:bg-hl-wash">
            {on === lines.length ? t("Bỏ hết") : t("Chọn hết")}
          </button>
        </Hint>
      )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="lines" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }} className="overflow-hidden">
            <ul className="grid grid-cols-1 gap-1.5 pt-0.5">
              {lines.map((l) => {
                const off = isOff(l), [what, fix] = why(l);
                const label = l.why === "unknown" && l.hint ? l.hint : l.name;
                return (
                  <li key={l.no} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,input,button")) onCite(l.no); }}
                    className={cn("grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 rounded-lg border border-rule bg-cotton px-3 py-2.5 transition-[opacity,border-color] hover:border-hl/50", off && "bg-paper-2 opacity-70")}>
                    <Hint side="bottom" text={off ? t("Chọn lại: AI vẽ dòng này") : t("Bỏ chọn: AI không vẽ dòng này")}>
                      <input type="checkbox" checked={!off} onChange={() => onToggle(l)} aria-label={t("Vẽ dòng #{n}", { n: l.no })} className="mt-0.5 size-4 accent-(--color-hl)" />
                    </Hint>
                    <div className="grid grid-cols-1 gap-1">
                      <div className="flex items-start gap-2">
                        <Hint side="bottom" text={t("Đưa dòng này vào câu hỏi AI (bấm cả dòng cũng được)")}>
                          <button type="button" onClick={() => onCite(l.no)} className="shrink-0 rounded bg-hl-wash px-1.5 font-mono text-2xs leading-5 text-hl-2 hover:brightness-95">#{l.no}</button>
                        </Hint>
                        <span className={cn("min-w-0 font-mono text-xs leading-5 break-words text-ink", off && "line-through")}><Linked text={l.line} /></span>
                      </div>
                      {/* the reason stays on a line left out (the default): it is why the line is not drawn */}
                      <p className="text-xs text-warn">{what}</p>
                      <p className="text-xs text-ink-2"><b className="font-medium text-ink">{t("Cách sửa:")}</b> {fix}</p>
                      {off && <p className="text-xs text-ink-3">{t("Bỏ qua: AI không vẽ liên kết này")}</p>}
                      {!!l.urls?.length && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {l.urls.map((u, i) => (
                            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full border border-rule px-2 py-0.5 text-2xs text-hl-2 hover:bg-hl-wash">
                              <ExternalLink className="size-3 shrink-0" aria-hidden /><span className="truncate">Zeplin · {label}{l.urls!.length > 1 ? ` ${i + 1}` : ""}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// Light-colour steps for the stacked bar: the largest source first, so the shade steps down with the share.
const SHADE = ["bg-hl", "bg-hl/70", "bg-hl/45", "bg-hl/30", "bg-hl/15"];

/** What the dialog adds to the render's note: the platform, the Q&A on the flow. The screens left out are not in it
 *  (they are not sent: `skip`), nor the unclear lines left out: the server writes those, every one (`draw`). */
function extraNote(turns: Turn[], target: Target) {
  const done = turns.filter((x) => x.a);
  return [
    target === "web" ? "Sơ đồ này cho web (không phải app mobile): vẽ luồng trang web." : "",
    done.length ? "Làm rõ luồng trước khi vẽ (hỏi đáp với AI):\n" + done.map((x) => `Hỏi: ${x.q}\nĐáp: ${x.a}`).join("\n\n") : "",
  ].filter(Boolean).join("\n\n").slice(0, 5500);
}

/** Before every AI render. Opens at once and counts the input (POST /flow/precheck, no AI). Left: the token count,
 *  the warnings (folded per group), and the three ways to render as radio cards; right: a Q&A with a light AI;
 *  footer: model / effort and platform beside Hủy and the chosen render. The platform's off screens (and the ones
 *  unticked) are `skip`: the count, the warnings and the render follow them. */
export function FlowRisks({ issue, target, open, onOpenChange, onRun, onScreens, onSplit }: {
  issue: string; target: Target; open: boolean; onOpenChange: (o: boolean) => void;
  onRun: (extra: string, draw: string[]) => void; onScreens: () => void; onSplit: (extra: string, draw: string[]) => void;
}) {
  const t = useT();
  const [flip, setFlip] = useState<Set<string>>(new Set()); // unclear lines the user ticked to draw, by lineKey (default: left out)
  const [picked, setPicked] = useState<Mode | null>(null); // the way the user chose; null: the suggested one
  const [ask, setAsk] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const check = useFlowCheck(issue, open, target);
  const data = check.data, error = check.error;
  const feed = useFollow(turns);
  const qa = useMutation({
    mutationFn: ({ q, advice }: { q: string; advice?: boolean }) => advice ? yt.flowAdvice(issue, "", target)
      : yt.flowAsk(issue, "", turns.filter((x) => x.a).slice(-12).map((x) => ({ q: x.q, a: x.a ?? "" })), q, target),
    onMutate: ({ q }) => { setTurns((all) => [...all, { q }]); setAsk(""); },
    onSuccess: (r) => setTurns((all) => all.map((x, i) => (i === all.length - 1 ? { ...x, a: r.text } : x))),
    onError: (e) => setTurns((all) => all.map((x, i) => (i === all.length - 1 ? { ...x, error: say(e) } : x))),
  });
  const send = () => { const q = ask.trim(); if (q && !qa.isPending) qa.mutate({ q }); };
  // an unclear line is left out unless the user ticked it: the render draws what is clear, the rest is opt-in
  const isOff = (l: Line) => !flip.has(lineKey(l));
  const setOff = (ls: Line[], off: boolean) => setFlip((s) => {
    const n = new Set(s);
    for (const l of ls) { if (off) n.delete(lineKey(l)); else n.add(lineKey(l)); }
    return n;
  });
  // the platform was picked before: neither size group is a warning here (the other platform is simply not sent)
  const risks = (data?.risks ?? []).filter((r) => r.code !== "web" && r.code !== "mobile");
  const lines = risks.flatMap((r) => r.lines ?? []);
  const extra = () => extraNote(turns, target);
  const draw = () => lines.filter((l) => !isOff(l)).map((l) => l.line); // ticked: the server leaves out the rest
  const parts = Object.entries(data?.parts ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = parts.reduce((sum, [, n]) => sum + n, 0) || 1;
  const chunks = data?.chunks ?? 1;
  const split = chunks > 1;
  // a split is only a way when the flow has more than one part; the picked default is the split then, else the AI render
  const mode: Mode = picked && (picked !== "split" || split) ? picked : split ? "split" : "ai";
  const close = (o: boolean) => { if (!o) qa.reset(); onOpenChange(o); };
  const changed = turns.some((x) => x.a) || flip.size > 0 || target === "web";
  const run = () => {
    const x = extra();
    close(false);
    if (mode === "screens") onScreens();
    else if (mode === "split") onSplit(x, draw());
    else onRun(x, draw());
  };
  const confirm = mode === "screens" ? t("Dựng màn hình") : mode === "split" ? t("Chia {n} phần và render", { n: chunks })
    : changed ? t("Render kèm phần đã làm rõ") : t("Render bằng AI");
  return (
    <ConfirmDialog open={open} onOpenChange={close} tone="default" icon={data && !risks.length ? Sparkles : TriangleAlert} className="sm:max-w-5xl"
      title={!data ? t("Kiểm tra trước khi render") : risks.some((r) => r.code !== "ambiguous") ? t("Lượt vẽ này có thể tốn nhiều token") : risks.length ? t("Có dòng luồng chưa rõ: AI chỉ vẽ phần đã rõ") : t("Sẵn sàng render bằng AI")}
      description={!data ? (error ? t("Không đếm được token") : t("Đang đếm token và dò các điểm chưa rõ…")) : <>
        {t("~{n} token đầu vào · {s} màn", { n: fmtK(data.tokens), s: data.screens })}
        {data.cost_usd != null && <> · {t("~{c} trên {m}", { c: fmtUsd(data.cost_usd), m: data.model || "default" })}</>}
      </>}
      footerStart={<>
        <YtPicks heavy />
        <Hint side="bottom" text={t("Nền tảng đã chọn trước khi render, không đổi ở đây. Muốn đổi: đóng hộp này rồi đổi ở dưới hai thẻ chọn cách dựng, hoặc trong câu hỏi Render lại.")}>
          <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-full bg-hl-wash px-2.5 py-1 text-xs font-medium text-hl-2">
            {target === "web" ? <Monitor className="size-3.5" aria-hidden /> : <Smartphone className="size-3.5" aria-hidden />}
            {t("Nền tảng: {p}", { p: target === "web" ? t("Web") : t("Mobile") })}
          </span>
        </Hint>
      </>}
      confirmLabel={confirm}
      onConfirm={run}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-h-0 flex-col gap-3 md:h-[62vh]">
          {data && (
            <section className="grid shrink-0 grid-cols-1 gap-1.5" aria-label={t("Token theo nguồn")}>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-paper-3">
                {parts.map(([name, n], i) => <span key={name} className={cn("h-full", SHADE[i] ?? SHADE.at(-1))} style={{ width: `${(n / total) * 100}%` }} />)}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                {parts.map(([name, n], i) => (
                  <li key={name} className="flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", SHADE[i] ?? SHADE.at(-1))} aria-hidden />
                    {PART[name] ? t(PART[name]) : name}<span className="font-mono text-2xs tabular-nums text-ink-3">{fmtK(n)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 md:overflow-y-auto md:pr-1">
            {error && <p role="alert" className="text-sm text-error">{t("Không đếm được token: {msg}", { msg: say(error) })}</p>}
            {!data && !error ? <AiFetching kind="flow" className="min-h-64" lines={[t("Đang đếm token theo từng nguồn"), t("Đang dò luồng màn chưa rõ"), t("Đang kiểm màn mobile / web")]} />
              : data && <>
                {risks.some((r) => !r.lines?.length) && (
                  <ul className="grid grid-cols-1 gap-1 rounded-lg bg-paper-2 px-3 py-2">
                    {risks.filter((r) => !r.lines?.length).map((r) => (
                      <li key={r.code} className="flex items-start gap-2 text-sm text-ink"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />{r.text}</li>
                    ))}
                  </ul>
                )}
                {!risks.length && <p className="text-sm text-ink-2">{t("Không thấy điểm nào cần sửa: AI đọc đủ nguồn với model / effort đã chọn.")}</p>}
                {risks.filter((r) => r.lines?.length).map((r) => (
                  <Issues key={r.code} risk={r} isOff={isOff} onCite={(no) => setAsk((v) => `${v.trimEnd()} #${no} `.trimStart())}
                    onToggle={(l) => setOff([l], !isOff(l))} onSetAll={setOff} />
                ))}
              </>}
          </div>
          <section className="grid shrink-0 grid-cols-1 gap-2 border-t border-rule pt-3">
            <h3 className="text-sm font-bold text-ink">{t("Chọn cách render")}</h3>
            <div role="radiogroup" aria-label={t("Chọn cách render")} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <OptionCard value="screens" picked={mode} badge={t("Gợi ý")} icon={Code} title={t("Dựng màn hình")}
                when={t("Chỉ UI các màn Zeplin, không nút, không mũi tên: Markdown cho AI không có luồng bấm")} cost={t("0 token · vài giây")}
                tip={t("Khi nào: cần khung các màn để dựng nhanh. Đánh đổi: không có nút và mũi tên nối màn, AI không đọc AC; Markdown cho AI chỉ có danh sách màn và ticket, agent phải tự đoán luồng và AC thuộc màn nào (nối tay trong Sửa hoặc render bằng AI để đủ).")} onPick={setPicked} />
              <OptionCard value="split" picked={mode} disabled={!split} icon={Layers} title={split ? t("Chia {n} phần", { n: chunks }) : t("Chia phần")}
                when={split ? t("Chia màn thành nhóm {p} màn, render song song rồi ghép", { p: PART_SCREENS }) : t("Chỉ có khi ticket trên {p} màn", { p: PART_SCREENS })}
                cost={!split ? t("không áp dụng") : data?.split_tokens ? t("~{k} token · {n} lượt AI song song", { k: fmtK(data.split_tokens), n: chunks }) : t("{n} lượt AI chạy song song", { n: chunks })}
                tip={t("Khi nào: nhiều màn (trên {p}) hoặc model nhẹ hay vẽ thiếu. Đánh đổi: AC và ticket gửi lại trong mỗi phần nên tốn token hơn; link giữa hai phần khác nhau có thể thiếu.", { p: PART_SCREENS })} onPick={setPicked} />
              <OptionCard value="ai" picked={mode} icon={Sparkles} title={t("Render bằng AI")}
                when={t("Một lượt AI đọc đủ ticket và vẽ luồng có mũi tên")}
                cost={data ? t("~{k} token · 1 lượt AI", { k: fmtK(data.tokens) }) : t("1 lượt AI")}
                tip={t("Khi nào: ít màn và cần mũi tên nối đúng luồng, Markdown cho AI có nút → màn đích, điều kiện, AC theo từng màn và đường đi kiểm thử. Đánh đổi: chậm hơn; với nhiều màn, model nhẹ dễ vẽ thiếu.")} onPick={setPicked} />
            </div>
          </section>
        </div>
        <aside aria-label={t("Hỏi AI về luồng màn")} className="flex h-96 min-h-0 flex-col overflow-hidden rounded-xl border border-rule bg-paper-2 md:h-[62vh]">
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
            <Sparkles className="size-3.5 text-hl" aria-hidden />
            <span className="flex-1 text-sm font-medium text-ink">{t("Hỏi AI")}</span>
            {turns.length > 0 && <span className="font-mono text-2xs tabular-nums text-ink-3">{turns.length}</span>}
          </div>
          <div {...feed} className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto p-3">
            {!turns.length && <p className="text-xs text-ink-3">{t("Hỏi về dòng #số, dán link Zeplin / spec, hoặc mô tả thêm luồng. Câu trả lời được gửi kèm khi render.")}</p>}
            {turns.map((x, i) => (
              <div key={i} className="grid grid-cols-1 gap-2">
                <UserBubble>{x.q}</UserBubble>
                {x.a ? <AiResultCard><Markdown text={x.a} className="text-sm" /></AiResultCard>
                  : x.error ? <AiResultCard error>{t("AI không trả lời được: {msg}", { msg: x.error })}</AiResultCard>
                  : <AiThinking />}
              </div>
            ))}
          </div>
          <div className="p-2">
            <AiPromptBox value={ask} onChange={setAsk} onSend={send} running={qa.isPending} aria-label={t("Hỏi AI về luồng màn")}
              placeholder={t("Hỏi về #số, dán link, mô tả thêm…")} maxLength={2000}
              tools={<AiAsk label={t("Phân tích bằng AI")} openRight hint={t("Model nhẹ đọc bảng số liệu này (không đọc ticket), nêu lý do và hướng xử lý")} onClick={() => { if (!qa.isPending) qa.mutate({ q: t("Phân tích bằng AI"), advice: true }); }} />}
              actions={<Hint side="bottom" text={t("Gửi câu hỏi; câu trả lời được đưa vào lượt vẽ")}>
                <Button size="sm" className="rounded-full bg-hl" disabled={!ask.trim() || qa.isPending} onClick={send} aria-label={t("Gửi")}><Send aria-hidden /></Button>
              </Hint>} />
          </div>
        </aside>
      </div>
    </ConfirmDialog>
  );
}
