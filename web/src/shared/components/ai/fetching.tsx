"use client";

import { AlarmClock, Check, FileText, Gauge, GitBranch, History, Hourglass, LayoutDashboard, ListChecks, MessageCircleQuestion, PackageCheck, Rocket, RotateCw, Search, Send, Server, ShieldCheck, Sparkles, TriangleAlert, X } from "lucide-react";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { AgentIcon } from "@/shared/components/ai/agent-icon";
import { AiBot, AiThinking } from "@/shared/components/ai/chat";
import { YtLogo } from "@/shared/components/yt-logo";
import { type Key, t as tNow, type T, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

// Waiting on YouTrack / Telegram: one frame (shown at least AI_WAIT_MS via useAiWait, zoomed down in a narrow box, rotating lines, a running bar),
// one scene per feature that acts out what the feature does with the data. Scenes draw in a 320 × 160 box; paths are in its px.

export type FetchKind = "waiting" | "tickets" | "release" | "people" | "chat" | "inbox" | "history" | "qa" | "brief" | "agent" | "digest" | "today" | "update" | "restart" | "deep" | "code" | "runs" | "sessions" | "flow";

/** Each scene's rotating lines, as keys: translated where shown. */
const LINES: Record<FetchKind, Key[]> = {
  tickets: ["AI đang kết nối YouTrack", "Đang gom ticket của bạn", "Đang đọc trạng thái, người làm, sprint", "Sắp xếp lại cho gọn", "Sắp xong rồi"],
  release: ["AI đang kết nối YouTrack", "Đang gom ticket của release", "Đang đọc liên kết, bình luận", "Đang dò ticket chặn go-live", "Sắp xong rồi"],
  people: ["AI đang kết nối YouTrack", "Đang gom ticket cả team", "Đang đếm việc từng người", "Đang tìm ticket blocked, quá hạn", "Sắp xong rồi"],
  chat: ["AI đang kết nối Telegram", "Đang gom tin của nhóm", "Đang đọc tag, reply, người gửi", "Sắp xong rồi"],
  inbox: ["AI đang kết nối Telegram", "Đang gom tin tag / reply bạn", "Đang xếp theo độ gấp", "Đang viết danh sách việc cần xử lý"],
  history: ["AI đang kết nối Telegram", "Đang đọc hội thoại của nhóm", "Đang gom tin trong khoảng đã chọn", "Sắp xong rồi"],
  qa: ["AI đang kết nối Telegram", "Đang đọc các câu hỏi #QA", "Đang gom câu trả lời trong chuỗi", "Đang tìm câu chưa ai trả lời", "Sắp xong rồi"],
  brief: ["AI đang kết nối Telegram", "Đang gom tóm tắt các nhóm", "Đang tìm việc chờ bạn", "Đang xếp theo độ gấp", "Sắp xong rồi"],
  digest: ["AI đang đọc hội thoại của nhóm", "Đang ghép câu hỏi với câu trả lời", "Đang gom theo chủ đề, đánh dấu trao đổi với BE", "Đang tìm việc cần confirm, điều đã chốt", "Sắp xong rồi"],
  waiting: ["AI đang xem việc bạn đang chờ người khác", "Đang đọc tag đã hoãn", "Đang dò câu hỏi Q&A chưa ai trả lời", "Sắp xong rồi"],
  today: ["AI đang gom việc của bạn", "Đang đọc tag chờ, phiên AI và câu hỏi Q&A", "Đang soi ticket YouTrack rủi ro", "Đang tổng hợp theo từng việc", "Đang viết danh sách việc chờ bạn"],
  update: ["AI đang kết nối GitHub", "Đang kéo bản mới về", "Đang kiểm checksum và chữ ký", "Đang cài bản mới", "Sắp xong rồi"],
  restart: ["Đã cài bản mới", "Đang khởi động lại server", "Đang chờ server lên lại", "Sắp tải lại trang"],
  deep: ["AI đang mở dự án", "Đang đọc câu hỏi gửi BE và câu BE trả lời", "Đang soi code: API, model, màn hình", "Đang so: đã adapt, lệch hay chưa làm", "Đang viết bảng đối chiếu"],
  code: ["AI đang mở dự án", "Đang tìm và đọc code liên quan", "Đang so sánh các đoạn code", "Đang đọc tin nhắn và bình luận", "Đang so code với nội dung trao đổi", "Đang viết lại báo cáo"],
  runs: ["AI đang lắng nghe Claude, Codex", "Đang mở file của từng request", "Đang gom model, token, thời gian chạy", "Đang ghi chú lại thành lịch sử", "Sắp xong rồi"],
  sessions: ["AI đang mở lịch sử phiên AI", "Đang gom ticket của từng phiên", "Đang đọc lại câu hỏi và câu trả lời", "Đang xếp phiên theo ngày", "Sắp xong rồi"],
  flow: ["AI đang đọc AC và rule của ticket", "Đang mở màn hình trên Zeplin", "Đang xếp các màn thành luồng", "Đang nối nút với màn đích", "Sắp xong rồi"],
  agent: ["Đang đọc tin cần xử lý", "Đang mở ticket, link trong tin", "Đang ghép phân tích và yêu cầu thêm", "Đang mở dự án", "Đang khởi động phiên AI Agent"],
};

/** The digest scene's lines, naming the group being read. */
export const digestLines = (group?: string) =>
  [group ? tNow("AI đang đọc hội thoại {group}", { group }) : tNow(LINES.digest[0]), ...LINES.digest.slice(1).map((k) => tNow(k))];

/** The Đối chiếu BE scene's lines, naming the project and how many topics. */
export const deepLines = (project?: string, topics?: number) =>
  [project ? tNow("AI đang mở dự án {project}", { project }) : tNow(LINES.deep[0]), topics ? tNow("Đang đọc {n} chủ đề hỏi / BE", { n: topics }) : tNow(LINES.deep[1]),
    ...LINES.deep.slice(2).map((k) => tNow(k))];

/** Shortest time a loading scene stays up, so it plays through instead of flashing (user ask: 0.5–1s). */
export const AI_WAIT_MS = 800;

/** `pending`, held for at least AI_WAIT_MS once it starts; data already cached is never pending, so it shows at once. */
export function useAiWait(pending: boolean, ms = AI_WAIT_MS) {
  const since = useRef(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (pending) { since.current = Date.now(); setHold(true); return; } // eslint-disable-line react-hooks/set-state-in-effect -- the hold follows a prop edge
    const t = setTimeout(() => setHold(false), Math.max(0, since.current + ms - Date.now()));
    return () => clearTimeout(t);
  }, [pending, ms]);
  return pending || hold;
}

/** A page's ↻: refetch its active queries under `keys`; `busy` while they run (feed it to useAiWait to replay the scene).
 *  A failed read shows where that query is used, so nothing is swallowed here. */
export function useReload(keys: QueryKey[]) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    void Promise.all(keys.map((queryKey) => qc.refetchQueries({ queryKey, type: "active" }))).finally(() => setBusy(false));
  };
  return [busy, run] as const;
}

/**
 * Waiting on the data a feature reads; `project` names YouTrack ticket IDs (for `agent`: the project folder), `lines` replaces the feature's own.
 * `cover`: laid over the (relative) list box, so the rows render and scroll into place underneath during the hold. Put it
 * in a non-scrolling `relative` wrapper beside the scroll box, never inside it (inside, it rides the scroll out of view).
 * Otherwise it fills the box it waits in (flex-1 / h-full, at least 50vh) so the scene sits in its middle, not at its top.
 */
export function AiFetching({ kind, project = "", lines, cover, className }: { kind: FetchKind; project?: string; lines?: string[]; cover?: boolean; className?: string }) {
  const t = useT();
  const Scene = SCENES[kind];
  return (
    <div className={cn("@container grid w-full place-items-center", cover ? "absolute inset-0 z-10 bg-cotton" : "h-full min-h-[50vh] flex-1 py-6", className)}>
      <div className="grid justify-items-center gap-5 animate-in fade-in-0 zoom-in-95 duration-(--dur-short) @max-[21rem]:[zoom:0.8]">
        {/* the scene is drawn in px (positions, flight paths): it grows with the frame by zoom, never by its box */}
        <div aria-hidden className="relative h-40 w-80 @min-[36rem]:[zoom:1.3] @min-[52rem]:[zoom:1.55]"><Scene p={project} t={t} /></div>
        <AiThinking lines={lines ?? LINES[kind].map((k) => t(k))} className="w-72 max-w-full justify-center @min-[36rem]:w-96 @min-[36rem]:[&_.ai-text]:text-base [&>svg]:hidden" />
        <span className="ai-bar h-1 w-56 max-w-full rounded-full @min-[36rem]:w-80" />
      </div>
    </div>
  );
}

/** The update scene at rest (same 320 × 160 box as the running one): GitHub, the robot, the app, joined by dashed links. */
export function UpdateHero({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative h-40 w-80", className)}>
      <span className="absolute top-[70px] right-[198px] left-[66px] border-t-2 border-dashed border-rule-2" />
      <span className="absolute top-[70px] right-[66px] left-[198px] border-t-2 border-dashed border-rule-2" />
      <Tile label="GitHub" className="top-1/2 left-1 -translate-y-1/2"><GitHubMark /></Tile>
      <Bot className="top-1/2 left-1/2 size-20 -translate-x-1/2 -translate-y-1/2" />
      <Tile label="App" className="top-1/2 right-1 -translate-y-1/2"><PackageCheck className="size-8 text-ok" /></Tile>
    </div>
  );
}

/** Nothing left to do (Hôm nay, Việc cần xử lý; same 320 × 160 box): the robot rests, the jobs it cleared circle it as ticked cards. */
export function AllDone({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative h-40 w-80", className)}>
      <span className="absolute top-1/2 left-1/2 size-36 -translate-1/2 rounded-full border border-dashed border-ok/40" />
      <span className="ai-spin absolute top-1/2 left-1/2 size-36 -translate-1/2" style={{ animationDuration: "14s" }}>
        {[0, 120, 240].map((deg) => (
          <span key={deg} className="absolute top-1/2 left-1/2 -translate-1/2" style={{ transform: `rotate(${deg}deg) translateY(-72px) rotate(-${deg}deg)` }}>
            <span className="ai-spin grid size-6 place-items-center rounded-full border border-rule bg-cotton shadow-stock" style={{ animationDuration: "14s", animationDirection: "reverse" }}><Check className="size-3.5 text-ok" /></span>
          </span>
        ))}
      </span>
      {([["top-3 left-16", "size-3"], ["right-14 bottom-5", "size-4"], ["top-8 right-20", "size-2.5"]] as const).map(([at, sz], k) => (
        <Sparkles key={k} className={cn("ai-twinkle absolute text-hl-2", at, sz)} style={{ animationDelay: `${k * 0.4}s` }} />
      ))}
      <Bot className="top-1/2 left-1/2 size-20 -translate-x-1/2 -translate-y-1/2" />
      <span className="sk-pop absolute top-[88px] left-[172px] grid size-7 place-items-center rounded-full bg-ok text-cotton shadow-stock" style={{ animationDelay: "0.3s" }}><Check className="size-4" strokeWidth={3} /></span>
    </div>
  );
}

// ---- pieces

const C = { hl: "var(--color-hl)", hl2: "var(--color-hl-2)", info: "var(--color-info)", ok: "var(--color-ok)", warn: "var(--color-warn)", err: "var(--color-error)" };
const v = (o: Record<string, string | number>) => o as CSSProperties;
const CHIP = "inline-flex h-5 items-center gap-1 rounded-full border border-rule bg-cotton px-1.5 font-mono text-[10px] font-medium whitespace-nowrap text-ink-2 shadow-stock";

/** The `k`-th item of a stream riding `path`; it shrinks away at the end (behind whatever is drawn after it). */
function Fly({ path, k, gap = 0.4, dur, dot, className = CHIP, children }: { path: string; k: number; gap?: number; dur?: number; dot?: string; className?: string; children?: ReactNode }) {
  return (
    <span className={cn("ai-sample absolute top-0 left-0", className)} style={{ offsetPath: `path("${path}")`, animationDelay: `${k * gap}s`, animationDuration: dur ? `${dur}s` : undefined }}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}{children}
    </span>
  );
}

/** The AI: the robot floating in its glow; `ring` adds the receiving pulse and an orbiting sparkle. */
function Bot({ className, size = "size-14", ring }: { className: string; size?: string; ring?: boolean }) {
  return (
    <div className={cn("absolute grid place-items-center", className)}>
      <span className="ai-halo absolute inset-2 rounded-full bg-hl/30 blur-xl" />
      {ring && <>
        <span className="absolute inset-3 animate-ping rounded-full bg-hl/15 [animation-duration:1.6s]" />
        <span className="absolute inset-0 rounded-full border border-dashed border-hl/30" />
        <span className="ai-spin absolute inset-0"><Sparkles className="ai-twinkle absolute top-0 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 text-hl-2" /></span>
      </>}
      <AiBot className={cn("ai-float relative drop-shadow-lg", size)} />
    </div>
  );
}

/** A source on its stack, named under it. */
function Tile({ children, label, className }: { children: ReactNode; label: string; className: string }) {
  return (
    <div className={cn("absolute grid justify-items-center gap-1.5", className)}>
      <div className="relative size-14">
        <span className="absolute inset-0 translate-x-1.5 -translate-y-1.5 rotate-6 rounded-xl border border-rule bg-paper-2" />
        <span className="absolute inset-0 translate-x-0.5 -translate-y-0.5 rotate-3 rounded-xl border border-rule bg-cotton" />
        <span className="relative grid size-14 place-items-center rounded-xl border border-rule bg-cotton shadow-stock">{children}</span>
      </div>
      <span className="max-w-20 truncate font-mono text-[10px] font-bold tracking-wide text-ink-3">{label}</span>
    </div>
  );
}

/** Telegram's mark, as on the Telegram switch and the sidebar plug. */
const Tg = ({ className = "size-9", icon = "size-5" }: { className?: string; icon?: string }) => (
  <span className={cn("grid place-items-center rounded-full bg-info text-cotton", className)}><Send className={cn("-translate-x-px translate-y-px", icon)} /></span>
);
const GitHubMark = () => <span className="grid size-9 place-items-center rounded-full bg-ink text-cotton"><GitBranch className="size-5" /></span>;
const Line = ({ w, className }: { w: string | number; className?: string }) => <span className={cn("block h-1 rounded-full bg-ink-3/25", className)} style={{ width: w }} />;
/** A soft cone pointing at the robot (wide at the data, narrow at the robot). */
const Cone = ({ className }: { className: string }) => (
  <span className={cn("absolute animate-pulse bg-linear-to-r from-hl/5 to-hl/25 [clip-path:polygon(0_0,100%_42%,100%_58%,0_100%)]", className)} />
);
/** A chat bubble; `tag`: the "@you" label it starts with. */
const Bubble = ({ me, w, tag }: { me?: boolean; w: string; tag?: string }) => (
  <div className={cn("mb-1.5 grid gap-1 rounded-2xl px-2 py-1.5", me ? "self-end rounded-br-sm bg-hl/25" : "self-start rounded-bl-sm bg-cotton shadow-stock", w)}>
    {tag && <span className="font-mono text-[9px] leading-none font-bold text-info">{tag}</span>}
    <Line w="90%" /><Line w="60%" />
  </div>
);

/** The to-do list the robot writes (right of the box): a title, then `rows` ([width, dot colour]) written one by one. */
const Sheet = ({ rows }: { rows: (readonly [number, string])[] }) => (
  <div className="absolute top-2 right-1 bottom-2 w-[100px] rounded-lg border border-rule bg-cotton p-2 shadow-stock">
    <Line w="60%" className="h-1.5 bg-ink-3/40" />
    {rows.map(([w, c], k) => {
      const at = v({ "--fx-d": "4.4s", animationDelay: `${0.6 + k * 0.7}s` });
      return (
        <div key={k} className="mt-3 flex items-center gap-1.5">
          <span className="fx-step size-2 shrink-0 rounded-full" style={{ ...at, background: c }} />
          <span className="fx-step block h-1 rounded-full bg-ink-3/30" style={{ ...at, width: w }} />
        </div>
      );
    })}
  </div>
);

// ---- scenes

type Scene = (a: { p: string; t: T }) => ReactNode;
const tid = (p: string, n: number) => `${p || "YT"}-${n}`; // a ticket ID of the current project
const ARCS = ["M44 70C110 -6 200 0 268 80", "M44 70C110 150 200 160 268 80"];

const SCENES: Record<FetchKind, Scene> = {
  // UI flow: the robot sets down three phone screens one by one, then draws the arrows from a button to the next screen
  // (solid) and the way back (dashed grey), each with a dot running along it
  flow: () => {
    const go = ["M64 112C98 112 102 96 136 96", "M184 112C218 112 222 96 256 96"], back = "M136 138C112 158 88 158 64 138";
    const step = (k: number) => v({ "--fx-d": "4.8s", animationDelay: `${k * 0.45}s` });
    return <>
      {[16, 136, 256].map((x, k) => (
        <div key={x} className="fx-step absolute top-[64px] grid h-[88px] w-12 content-start gap-1.5 rounded-xl border border-rule bg-cotton px-1.5 pt-2 shadow-stock" style={{ ...step(k), left: x }}>
          <span className="mx-auto block h-1 w-4 rounded-full bg-ink-3/30" />
          <Line w="70%" className="h-1.5 bg-ink-3/40" />
          {[0, 1, 2].map((r) => <span key={r} className={cn("block h-2.5 rounded-sm", r === 1 && k < 2 ? "bg-hl/50" : "bg-paper-3")} />)}
        </div>
      ))}
      <svg viewBox="0 0 320 160" className="absolute inset-0 overflow-visible" fill="none" strokeLinecap="round">
        <defs><marker id="fx-flow-head" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6Z" fill={C.hl2} /></marker></defs>
        {go.map((d, k) => <path key={d} d={d} stroke={C.hl2} strokeWidth="2" markerEnd="url(#fx-flow-head)" className="fx-step" style={step(3 + k)} />)}
        <path d={back} stroke="var(--color-ink-3)" strokeWidth="1.5" strokeDasharray="4 3" className="fx-step" style={step(5)} />
      </svg>
      {go.map((d, k) => <Fly key={d} k={k} gap={0.6} dur={2.4} path={d} className="size-1.5 rounded-full bg-hl shadow-stock" />)}
      <Bot ring className="top-0 left-1/2 size-14 -translate-x-1/2" size="size-10" />
    </>;
  },

  // Hôm nay: the sources (Telegram tags, YouTrack tickets, Q&A) stream into the robot, which writes them up as a to-do list,
  // the urgent item first
  today: ({ p, t }) => {
    const src = [[14, <Tg key="tg" className="size-7" icon="size-4" />, "Telegram"], [62, <YtLogo key="yt" className="size-7" />, p || "YouTrack"],
      [110, <MessageCircleQuestion key="qa" className="size-6 text-info" />, "Q&A"]] as const;
    const chips = [[t("@bạn"), C.info, 0], [tid(p, 214), C.hl, 1], ["#QA", C.ok, 2], ["Blocked", C.err, 1], ["REF-", C.hl2, 0], [t("Quá hạn"), C.warn, 0]] as const;
    return <>
      {chips.map(([s, c, row], k) => {
        const y = src[row][0] + 18;
        return <Fly key={k} k={k} dot={c} gap={0.5} dur={2.6} path={`M48 ${y}C92 ${y} 100 80 140 80`}>{s}</Fly>;
      })}
      {Array.from({ length: 4 }, (_, k) => <Fly key={`o${k}`} k={k} gap={0.7} dur={2.2} path={`M170 80C190 80 196 ${52 + k * 22} 214 ${52 + k * 22}`} className="size-2 rounded-full bg-hl shadow-stock" />)}
      {src.map(([y, icon, label]) => (
        <div key={label} className="absolute left-0 flex h-9 w-[54px] items-center justify-center rounded-lg border border-rule bg-cotton shadow-stock" style={{ top: y }}>
          {icon}<span className="sr-only">{label}</span>
        </div>
      ))}
      <Bot ring className="top-1/2 left-[155px] size-16 -translate-x-1/2 -translate-y-1/2" size="size-11" />
      <Sheet rows={[[58, C.warn], [46, C.hl], [62, C.info], [40, C.ok]]} />
    </>;
  },

  // Bạn đang chờ: snoozed tags (left) and your questions still awaiting a reply (right, typing dots) drift into the robot,
  // which holds them on its hourglass until someone answers
  waiting: ({ p, t }) => <>
    {([[t("Hoãn"), C.warn, 0], ["#QA", C.info, 1], [tid(p, 12), C.hl, 0], ["@BE", C.info, 1], [t("Hoãn"), C.warn, 0], ["#QA", C.info, 1]] as const)
      .map(([s, c, side], k) => <Fly key={k} k={k} dot={c} gap={0.55} dur={2.8} path={side ? "M276 80C240 36 196 46 170 80" : "M44 80C80 124 124 114 150 80"}>{s}</Fly>)}
    <Tile label={t("Hoãn")} className="top-1/2 left-1 -translate-y-1/2"><AlarmClock className="size-8 text-warn" /></Tile>
    <Tile label="Q&A" className="top-1/2 right-1 -translate-y-1/2">
      <span className="flex gap-1">{[0, 1, 2].map((k) => <span key={k} className="ai-dot size-2 rounded-full bg-info" style={{ animationDelay: `${k * 0.15}s` }} />)}</span>
    </Tile>
    <Bot ring className="top-1/2 left-1/2 size-20 -translate-x-1/2 -translate-y-1/2" />
    <span className="absolute top-[98px] left-[176px] grid size-7 place-items-center rounded-full border border-rule bg-cotton shadow-stock"><Hourglass className="ai-hop size-4 text-hl-2" /></span>
  </>,

  // the ticket list: the robot pulls ticket IDs and fields out of YouTrack
  tickets: ({ p }) => <>
    <Cone className="inset-y-7 right-12 left-12" />
    {([[tid(p, 128), C.hl], ["State", C.info], [tid(p, 342), C.hl], ["Sprint", C.ok], ["Priority", C.err], [tid(p, 517), C.hl], ["Assignee", C.warn], ["Type", C.hl2]] as const)
      .map(([t, c], k) => <Fly key={k} k={k} dot={c} path={ARCS[k % 2]}>{t}</Fly>)}
    <Tile label={p || "YouTrack"} className="top-1/2 left-1 -translate-y-1/2"><YtLogo className="size-9" /></Tile>
    <Bot ring className="top-1/2 right-0 size-24 -translate-y-1/2" />
  </>,

  // release: tickets ride a belt through the robot's check; ready ones lift into the go-live rocket, blocked ones drop into "Chặn"
  release: ({ p, t }) => <>
    <span className="absolute top-[92px] right-16 left-8 border-t border-dashed border-rule-2" />
    <span className="absolute top-[40px] left-[149px] h-[50px] w-0.5 animate-pulse rounded-full bg-linear-to-b from-hl to-hl/0" />
    {([[`${tid(p, 128)} Done`, true], ["Blocked", false], [`${tid(p, 517)} Fixed`, true], [t("Quá hạn"), false], [`${tid(p, 206)} QC`, true], [`${tid(p, 731)} Done`, true]] as const)
      .map(([s, ok], k) => <Fly key={k} k={k} gap={0.55} dur={3.3} dot={ok ? C.ok : C.err} path={ok ? "M30 92H150C205 92 228 46 284 34" : "M30 92H150C205 92 236 134 278 142"}>{s}</Fly>)}
    <span className="absolute top-[72px] left-0 grid size-10 place-items-center rounded-lg border border-rule bg-cotton shadow-stock"><YtLogo className="size-6" /></span>
    <Bot className="top-0 left-[128px] size-11" size="size-9" />
    <div className="absolute top-0 right-0 grid justify-items-center gap-0.5">
      <span className="grid size-14 place-items-center rounded-full bg-hl-wash"><Rocket className="ai-float size-7 text-hl-2" /></span>
      <span className="font-mono text-[10px] font-bold text-ink-3">Go-live</span>
    </div>
    <span className="absolute right-1 bottom-1 rounded-md bg-error-wash px-1.5 py-0.5 text-[10px] font-medium text-error">{t("Chặn go-live")}</span>
  </>,

  // people: the robot deals ticket cards out to each member; their load bars rise and fall
  people: () => {
    const cols = [[40, "A", C.ok], [120, "B", C.warn], [200, "C", C.err], [280, "D", C.hl]] as const;
    return <>
      {Array.from({ length: 8 }, (_, k) => {
        const x = cols[k % 4][0];
        return <Fly key={k} k={k} gap={0.35} dur={2.8} path={`M160 40Q${x} 30 ${x} 76`} className="h-3 w-5 rounded-[3px] border border-rule border-l-2 border-l-hl bg-cotton shadow-stock" />;
      })}
      {cols.map(([x, n, c], k) => (
        <Fragment key={n}>
          <span className="absolute top-[70px] h-[52px] w-2.5 -translate-x-1/2 overflow-hidden rounded-full bg-paper-3" style={{ left: x }}>
            <span className="fx-grow absolute inset-0 rounded-full" style={v({ background: c, "--fx-d": `${1.4 + k * 0.45}s`, animationDelay: `${k * 0.3}s` })} />
          </span>
          <span className="absolute bottom-1 grid size-7 -translate-x-1/2 place-items-center rounded-full bg-paper-3 text-[11px] font-bold text-ink-2 shadow-stock" style={{ left: x }}>{n}</span>
        </Fragment>
      ))}
      <Bot className="top-0 left-1/2 size-14 -translate-x-1/2" size="size-10" />
    </>;
  },

  // a group's messages: the chat scrolls by, a scan line reads it, the robot takes it in
  chat: ({ t }) => {
    const feed = [[false, "w-28"], [true, "w-20"], [false, "w-24", true], [false, "w-16"], [true, "w-28"], [false, "w-20"]] as const;
    return <>
      <div className="absolute top-1 bottom-1 left-4 w-44 overflow-hidden rounded-xl border border-rule bg-paper-2 px-2">
        <div className="fx-scroll flex flex-col pt-2">{[...feed, ...feed].map(([me, w, tag], k) => <Bubble key={k} me={me} w={w} tag={tag ? t("@bạn") : undefined} />)}</div>
      </div>
      <span className="fx-scan absolute top-1 left-4 h-8 w-44 bg-linear-to-b from-transparent via-hl/25 to-transparent" style={v({ "--fx-y": "120px" })} />
      <Tg className="absolute -top-1 left-1 size-7 shadow-stock" icon="size-3.5" />
      <Cone className="top-9 bottom-9 left-[196px] right-14" />
      <Bot ring className="top-1/2 right-0 size-20 -translate-y-1/2" size="size-12" />
    </>;
  },

  // tags waiting on you: each passes through the robot and drops into its urgency lane
  // Việc cần xử lý: tags and replies to you stream from Telegram into the robot, which writes them up as a to-do list,
  // overdue first
  inbox: ({ t }) => <>
    {([[t("@bạn"), C.err], ["Reply", C.info], ["Tag", C.warn], [`${t("@bạn")} 3h`, C.err], [t("Hỏi"), C.warn], ["FYI", C.info]] as const)
      .map(([s, c], k) => <Fly key={k} k={k} gap={0.5} dur={2.6} dot={c} path="M44 80C80 52 104 52 140 80">{s}</Fly>)}
    {Array.from({ length: 4 }, (_, k) => <Fly key={`o${k}`} k={k} gap={0.7} dur={2.2} path={`M170 80C190 80 196 ${52 + k * 22} 214 ${52 + k * 22}`} className="size-2 rounded-full bg-hl shadow-stock" />)}
    <Tile label="Telegram" className="top-1/2 left-1 -translate-y-1/2"><Tg /></Tile>
    <Bot ring className="top-1/2 left-[155px] size-16 -translate-x-1/2 -translate-y-1/2" size="size-11" />
    <Sheet rows={[[58, C.err], [44, C.err], [62, C.warn], [40, C.info]]} />
  </>,

  // the digest's conversation: messages pop up day by day along a timeline, the picked range sweeps over them
  history: ({ t }) => {
    const pops = [[8, 74], [30, 46], [50, 82], [72, 58], [94, 34], [112, 76], [134, 50], [154, 84], [172, 40], [186, 66]];
    return <>
      <span className="absolute top-[108px] left-2 w-[204px] border-t border-rule-2" />
      {(["T2", "T3", "T4", "T5", "T6"] as const).map((d, k) => <span key={d} className="absolute top-[114px] -translate-x-1/2 font-mono text-[9px] text-ink-3" style={{ left: 22 + k * 44 }}>{t(d)}</span>)}
      {pops.map(([x, y], k) => (
        <span key={k} className={cn("fx-step absolute h-3.5 w-9 rounded-xl", k % 3 === 1 ? "rounded-br-sm bg-hl/40" : "rounded-bl-sm border border-rule-2 bg-cotton shadow-stock")}
          style={v({ left: x, top: y, "--fx-d": "4s", animationDelay: `${k * 0.3}s` })} />
      ))}
      <span className="fx-sweep absolute top-6 left-1 h-[100px] w-14 rounded-lg border border-hl/50 bg-hl/10" style={v({ "--fx-x": "150px" })} />
      <Tg className="absolute top-[132px] left-1 size-5" icon="size-3" />
      <span className="absolute top-[134px] left-7 font-mono text-[9px] text-ink-3">{t("khoảng đã chọn")}</span>
      <span className="absolute top-[80px] left-[214px] w-8 border-t border-dashed border-hl/40" />
      <Bot ring className="top-1/2 right-0 size-20 -translate-y-1/2" size="size-12" />
    </>;
  },

  // Q&A: a #QA question pings, answers join its thread one by one, the accepted one gets "Chốt"
  qa: ({ t }) => <>
    <span className="absolute top-[52px] bottom-3 left-[22px] border-l-2 border-rule-2" />
    <div className="absolute top-1 left-1 w-44">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-rule bg-cotton px-2 py-1.5 shadow-stock">
        <span className="relative grid size-4 shrink-0 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-info/40 [animation-duration:1.8s]" />
          <MessageCircleQuestion className="relative size-4 text-info" />
        </span>
        <span className="grid flex-1 gap-1"><span className="font-mono text-[9px] text-ink-3">#QA-12 · <b className="text-info">@dev</b></span><Line w="85%" /></span>
      </div>
    </div>
    {([[64, "w-28"], [92, "w-24"], [120, "w-32"]] as const).map(([y, w], k) => (
      <div key={k} className={cn("fx-step absolute left-8 grid gap-1 rounded-2xl rounded-tl-sm bg-paper-3 px-2 py-1.5", w)} style={v({ top: y, "--fx-d": "4.5s", animationDelay: `${0.5 + k * 0.8}s` })}>
        <Line w="90%" /><Line w="55%" />
      </div>
    ))}
    <span className="fx-step absolute top-[124px] left-[168px] flex items-center gap-0.5 rounded-full bg-ok-wash px-1.5 py-0.5 text-[10px] font-medium text-ok" style={v({ "--fx-d": "4.5s", animationDelay: "2.9s" })}>
      <Check className="size-3" />{t("Chốt")}
    </span>
    <Bot ring className="top-4 right-0 size-20" size="size-12" />
  </>,

  // briefing: each group's summary sends its points over, the robot writes the brief and ticks the to-dos
  brief: () => {
    const groups = [["A", 14], ["B", 60], ["C", 106]] as const;
    return <>
      {Array.from({ length: 6 }, (_, k) => {
        const y = groups[k % 3][1] + 18, to = 50 + (k % 4) * 24;
        return <Fly key={k} k={k} gap={0.45} dur={2.4} path={`M96 ${y}C150 ${y} 160 ${to} 214 ${to}`} className="size-2 rounded-full bg-hl shadow-stock" />;
      })}
      {groups.map(([n, y]) => (
        <div key={n} className="absolute left-1 flex h-9 w-[92px] items-center gap-1.5 rounded-lg border border-rule bg-cotton px-1.5 shadow-stock" style={{ top: y }}>
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-paper-3 text-[9px] font-bold text-ink-2">{n}</span>
          <span className="grid flex-1 gap-1"><Line w="90%" /><Line w="60%" /></span>
        </div>
      ))}
      <div className="absolute top-3 right-1 bottom-1 w-[104px] rounded-lg border border-rule bg-cotton p-2 pt-5 shadow-stock">
        <Line w="70%" className="h-1.5 bg-ink-3/40" />
        {[64, 48, 56, 40].map((w, k) => {
          const at = v({ "--fx-d": "4s", animationDelay: `${0.4 + k * 0.7}s` });
          return (
            <div key={k} className="mt-2.5 flex items-center gap-1.5">
              <span className="grid size-3 shrink-0 place-items-center rounded-[3px] border border-rule-2"><Check className="fx-step size-2.5 text-ok" style={at} /></span>
              <span className="fx-step block h-1 rounded-full bg-ink-3/30" style={{ ...at, width: w }} />
            </div>
          );
        })}
      </div>
      <Bot className="-top-2 right-[70px] size-12" size="size-9" />
    </>;
  },

  // summarizing a group: its back-and-forth scrolls by (PO / QA ask, BE answers), each message passes through the robot and lands
  // in what it is: a question still open, something settled, Q&A with BE
  digest: ({ t }) => {
    const feed = [["PO", "w-20", 0], ["BE", "w-16", 1], ["QA", "w-[72px]", 0], ["BE", "w-20", 1], ["Dev", "w-14", 0], ["PO", "w-[68px]", 0]] as const;
    const lanes = [[t("Cần confirm"), C.warn, 30, MessageCircleQuestion], [t("Đã chốt"), C.ok, 80, Check], [t("Với BE"), "var(--color-code)", 130, Server]] as const;
    return <>
      <div className="absolute top-1 bottom-1 left-0 w-[104px] overflow-hidden rounded-xl border border-rule bg-paper-2 px-1.5">
        <div className="fx-scroll flex flex-col gap-1.5 pt-2">
          {[...feed, ...feed].map(([who, w, be], k) => (
            <div key={k} className={cn("grid gap-1 rounded-2xl px-2 py-1.5", be ? "self-end rounded-br-sm bg-code/20" : "self-start rounded-bl-sm bg-cotton shadow-stock", w)}>
              <span className={cn("font-mono text-[8px] leading-none font-bold", be ? "text-code" : "text-ink-3")}>{who}</span>
              <Line w="90%" /><Line w="55%" />
            </div>
          ))}
        </div>
      </div>
      <span className="fx-scan absolute top-1 left-0 h-8 w-[104px] bg-linear-to-b from-transparent via-hl/25 to-transparent" style={v({ "--fx-y": "120px" })} />
      <Tg className="absolute -top-1 -left-1 size-6 shadow-stock" icon="size-3" />
      {([[t("Hỏi?"), 0, 40], ["BE: API", 2, 96], [t("Chốt"), 1, 64], [t("QA hỏi"), 0, 120], [t("Đổi field"), 2, 52], ["OK", 1, 108]] as const).map(([s, l, sy], k) => {
        const [, c, y] = lanes[l];
        return <Fly key={k} k={k} gap={0.55} dur={3.2} dot={c} path={`M100 ${sy}C122 ${sy} 128 80 154 80C192 80 204 ${y} 232 ${y}`}>{s}</Fly>;
      })}
      <Bot ring className="top-1/2 left-[112px] size-[72px] -translate-y-1/2" size="size-11" />
      {lanes.map(([l, c, y, Icon], n) => (
        <div key={l} className="absolute right-0 grid w-[84px] -translate-y-1/2 gap-1 rounded-md border border-rule bg-cotton px-1.5 py-1 shadow-stock" style={{ top: y }}>
          <span className="flex items-center gap-1 text-[9px] font-bold text-ink-2"><Icon className="size-2.5 shrink-0" style={{ color: c }} />{l}</span>
          <span className="flex gap-0.5">
            {[0, 1, 2].map((k) => <span key={k} className="fx-step block h-1 flex-1 rounded-full" style={v({ background: c, "--fx-d": "4.5s", animationDelay: `${0.6 + n * 0.3 + k * 0.9}s` })} />)}
          </span>
        </div>
      ))}
    </>;
  },

  // handing a message to the agent: the message, its tickets and links fly into the robot, which loads them line by line into the session
  // update: GitHub broadcasts the release; files stream along flowing beams into the robot, pass the signature gate as checked
  // packages and fill the app, which pops the new version with a burst of sparks
  update: ({ p, t }) => <>
    <svg viewBox="0 0 320 160" className="absolute inset-0 size-full overflow-visible" fill="none" strokeWidth="1.5" strokeLinecap="round">
      <path className="ai-beam" d="M58 64C96 26 128 34 146 66" stroke={C.hl} opacity="0.55" />
      <path className="ai-beam" d="M58 76C96 116 128 112 146 92" stroke={C.info} opacity="0.55" />
      <path className="ai-beam" d="M186 80C214 62 236 60 260 68" stroke={C.ok} opacity="0.6" />
    </svg>
    {([[p || "Release", C.hl], [".zip", C.info], ["sha256", C.ok], [t("chữ ký"), C.hl2], ["app/", C.warn], ["web/", C.info], ["VERSION", C.hl], ["uv.lock", C.ok]] as const)
      .map(([s, c], k) => <Fly key={k} k={k} dot={c} gap={0.4} dur={3.2} path={k % 2 ? "M44 80C84 130 124 120 160 80" : "M44 80C84 30 124 40 160 80"}>{s}</Fly>)}
    {[0, 1, 2].map((k) => <Fly key={`pk${k}`} k={k} gap={0.8} dur={2.4} path="M186 80C214 62 236 60 266 68"><ShieldCheck className="size-3 text-ok" />ok</Fly>)}
    <span className="absolute top-[40px] left-[222px] h-[60px] w-0.5 animate-pulse rounded-full bg-linear-to-b from-transparent via-ok to-transparent" />
    <span className="absolute top-[42px] left-1 size-14 animate-ping rounded-xl border-2 border-hl/40 [animation-duration:1.8s]" />
    <Tile label="GitHub" className="top-1/2 left-1 -translate-y-1/2"><GitHubMark /></Tile>
    <Bot ring className="top-1/2 left-1/2 size-20 -translate-x-1/2 -translate-y-1/2" />
    <span className="absolute top-[42px] right-1 size-14 animate-ping rounded-xl border-2 border-ok/40 [animation-duration:2.4s]" />
    <Tile label="App" className="top-1/2 right-1 -translate-y-1/2">
      <span className="fx-grow absolute inset-1 rounded-lg bg-ok/20" style={v({ "--fx-d": "2.4s" })} />
      <PackageCheck className="relative size-8 text-ok" />
    </Tile>
    {[[-26, -22, C.ok], [0, -34, C.hl], [26, -22, C.info], [30, 6, C.warn], [-30, 6, C.hl2], [0, 30, C.ok]].map(([dx, dy, c], k) => (
      <span key={k} className="ai-packet absolute top-[70px] left-[288px] size-1.5 rounded-full" style={v({ background: c, "--dx": `${dx}px`, "--dy": `${dy}px`, animationDelay: `${0.15 + k * 0.17}s` })} />
    ))}
    <span className={cn(CHIP, "fx-step absolute top-1 right-0 text-ok")} style={v({ "--fx-d": "3.2s" })}><Check className="size-3" />{p || t("mới")}</span>
  </>,

  // restart: the robot reboots the server: the power ring spins, rack lights blink back on one by one, the new version checks in
  restart: ({ p, t }) => <>
    <svg viewBox="0 0 320 160" className="absolute inset-0 size-full" fill="none" strokeWidth="1.5" strokeLinecap="round">
      <path className="ai-beam" d="M104 80H196" stroke={C.hl} opacity="0.6" />
    </svg>
    {[0, 1, 2].map((k) => <Fly key={k} k={k} gap={0.5} dur={1.5} path="M104 80H196" className="size-1.5 rounded-full bg-hl" />)}
    <Bot ring className="top-1/2 left-4 size-24 -translate-y-1/2" />
    <div className="absolute top-1/2 right-6 size-28 -translate-y-1/2">
      <span className="absolute inset-0 rounded-full border-2 border-dashed border-ok/40" />
      <span className="ai-spin absolute inset-0 [animation-duration:1.4s]"><RotateCw className="absolute -top-2 left-1/2 size-4 -translate-x-1/2 text-ok" /></span>
      <div className="absolute inset-5 grid content-center gap-1.5 rounded-xl border border-rule bg-cotton p-2 shadow-stock">
        {[0, 1, 2].map((r) => (
          <div key={r} className="flex items-center gap-1 rounded bg-paper-2 px-1.5 py-1">
            <span className="size-1.5 animate-pulse rounded-full bg-ok" style={{ animationDelay: `${r * 0.3}s` }} />
            <span className="size-1.5 animate-pulse rounded-full bg-hl" style={{ animationDelay: `${r * 0.3 + 0.15}s` }} />
            <Line w={24} className="ml-auto" />
          </div>
        ))}
      </div>
    </div>
    <span className={cn(CHIP, "fx-step absolute top-1 right-0 text-ok")} style={v({ "--fx-d": "2.6s" })}><Check className="size-3" />{p || t("mới")}</span>
  </>,

  agent: ({ p, t }) => {
    const srcs = [[22, t("Tin"), <Tg key="t" className="size-6" icon="size-3" />], [80, "Ticket", <YtLogo key="y" className="size-6" />], [138, "Link", <FileText key="f" className="size-5 text-hl-2" />]] as const;
    return <>
      {([[t("Tin nhắn"), 0, C.info], ["YT-128", 1, C.hl], ["link", 2, C.warn], [t("Phân tích"), 0, C.hl2], ["spec.md", 2, C.ok], ["YT-342", 1, C.hl]] as const)
        .map(([l, s, c], k) => { const y = srcs[s][0]; return <Fly key={k} k={k} gap={0.5} dur={2.8} dot={c} path={`M56 ${y}C100 ${y} 110 80 138 80`}>{l}</Fly>; })}
      {Array.from({ length: 4 }, (_, k) => <Fly key={k} k={k} gap={0.6} dur={1.6} path="M182 80H236" className="size-1.5 rounded-full bg-hl" />)}
      {srcs.map(([y, l, icon]) => (
        <div key={l} className="absolute left-0 flex h-9 w-14 -translate-y-1/2 items-center gap-1 rounded-lg border border-rule bg-cotton px-1 shadow-stock" style={{ top: y }}>
          {icon}<span className="font-mono text-[9px] font-bold text-ink-3">{l}</span>
        </div>
      ))}
      <Bot ring className="top-1/2 left-[118px] size-20 -translate-y-1/2" size="size-12" />
      <div className="absolute top-4 right-0 bottom-4 w-[84px] overflow-hidden rounded-lg border border-rule bg-paper-2 shadow-stock">
        <div className="flex items-center gap-0.5 border-b border-rule bg-cotton px-1.5 py-1">
          {[C.err, C.warn, C.ok].map((c) => <span key={c} className="size-1.5 rounded-full" style={{ background: c }} />)}
          <span className="ml-1 truncate font-mono text-[8px] text-ink-3">{p || "agent"}</span>
        </div>
        <div className="grid gap-2 p-1.5">
          {[48, 36, 56, 30, 44].map((w, k) => {
            const at = v({ "--fx-d": "4.5s", animationDelay: `${0.3 + k * 0.6}s` });
            return (
              <div key={k} className="flex items-center gap-1">
                <Check className="fx-step size-2.5 shrink-0 text-ok" style={at} />
                <span className="fx-step block h-1 rounded-full bg-ink-3/30" style={{ ...at, width: w }} />
              </div>
            );
          })}
          <span className="h-2 w-1 animate-pulse bg-hl" />
        </div>
      </div>
    </>;
  },
  // AI runs (History / Usage): the robot listens to each AI's sessions (Claude, Codex, this app); their request files fly into
  // it, sound rings pulse while it takes them in, and it notes each one down in the History log (time, model, a tick)
  runs: ({ t }) => {
    const srcs = [[24, <AgentIcon key="c" provider="claude" className="size-6" />, "Claude"], [80, <AgentIcon key="x" provider="codex" className="size-6" />, "Codex"],
      [136, <Gauge key="a" className="size-5 text-hl-2" />, "App"]] as const;
    const notes = [["09:14", "opus", C.hl], ["09:05", "gpt", C.info], ["08:59", "sonnet", C.ok], ["08:57", "haiku", C.warn], ["08:56", "opus", C.hl]] as const;
    return <>
      {([["req.jsonl", 0, C.hl], ["rollout", 1, C.info], ["6.9M tok", 0, C.hl2], [t("tóm tắt"), 2, C.ok], ["255s", 1, C.warn], ["opus", 0, C.hl]] as const)
        .map(([l, s, c], k) => { const y = srcs[s][0]; return <Fly key={k} k={k} gap={0.5} dur={2.8} dot={c} path={`M64 ${y}C100 ${y} 108 80 134 80`}>{l}</Fly>; })}
      {Array.from({ length: 4 }, (_, k) => <Fly key={`n${k}`} k={k} gap={0.7} dur={1.8} path="M180 80C196 80 200 66 214 66" className="size-1.5 rounded-full bg-hl" />)}
      {srcs.map(([y, icon, l]) => (
        <div key={l} className="absolute left-0 flex h-9 w-16 -translate-y-1/2 items-center gap-1 rounded-lg border border-rule bg-cotton px-1 shadow-stock" style={{ top: y }}>
          {icon}<span className="font-mono text-[9px] font-bold text-ink-3">{l}</span>
        </div>
      ))}
      {[0, 1, 2].map((k) => (
        <span key={k} className="absolute top-1/2 left-[157px] size-12 -translate-1/2 animate-ping rounded-full border-2 border-hl/40"
          style={{ animationDuration: "2.4s", animationDelay: `${k * 0.8}s` }} />
      ))}
      <Bot className="top-1/2 left-[122px] size-[72px] -translate-y-1/2" size="size-11" />
      <div className="absolute top-2 right-0 bottom-2 w-[100px] overflow-hidden rounded-lg border border-rule bg-cotton shadow-stock">
        <div className="flex items-center gap-1 border-b border-rule bg-paper-2 px-1.5 py-1">
          <FileText className="size-2.5 text-hl-2" />
          <span className="font-mono text-[8px] font-bold text-ink-2">History</span>
        </div>
        <div className="grid gap-[7px] p-1.5">
          {notes.map(([at0, m, c], k) => {
            const at = v({ "--fx-d": "4.5s", animationDelay: `${0.3 + k * 0.6}s` });
            return (
              <div key={k} className="fx-step flex items-center gap-1" style={at}>
                <span className="font-mono text-[7px] leading-none text-ink-3">{at0}</span>
                <span className="size-1 shrink-0 rounded-full" style={{ background: c }} />
                <span className="font-mono text-[7px] leading-none text-ink-2">{m}</span>
                <Check className="ml-auto size-2.5 shrink-0 text-ok" />
              </div>
            );
          })}
          <span className="h-2 w-1 animate-pulse bg-hl" />
        </div>
      </div>
    </>;
  },
  // Lịch sử AI (YouTrack): the robot reopens the sessions kept in this browser (their questions / answers) and pulls each
  // one's tickets from YouTrack, then files them into the history log by day
  sessions: ({ p, t }) => {
    const src = [[36, <YtLogo key="yt" className="size-6" />, p || "YouTrack"], [124, <History key="h" className="size-5 text-hl-2" />, t("Phiên AI")]] as const;
    const days = [[t("Hôm nay"), [[ListChecks, 52], [LayoutDashboard, 40], [ListChecks, 60]]], [t("Hôm qua"), [[ListChecks, 46], [LayoutDashboard, 56]]]] as const;
    let row = 0;
    return <>
      {([[tid(p, 128), C.hl, 0], ["Q", C.info, 1], [tid(p, 342), C.hl, 0], ["A", C.ok, 1], [tid(p, 517), C.hl, 0], [t("Phiên AI"), C.hl2, 1]] as const)
        .map(([s, c, from], k) => { const y = src[from][0]; return <Fly key={k} k={k} dot={c} gap={0.3} dur={2} path={`M48 ${y}C92 ${y} 100 80 140 80`}>{s}</Fly>; })}
      {Array.from({ length: 4 }, (_, k) => <Fly key={`o${k}`} k={k} gap={0.4} dur={1.6} path={`M170 80C190 80 196 ${48 + k * 24} 214 ${48 + k * 24}`} className="size-2 rounded-full bg-hl shadow-stock" />)}
      {src.map(([y, icon, l]) => (
        <div key={l} className="absolute left-0 flex h-9 w-[54px] -translate-y-1/2 items-center justify-center rounded-lg border border-rule bg-cotton shadow-stock" style={{ top: y }}>
          {icon}<span className="sr-only">{l}</span>
        </div>
      ))}
      <Bot ring className="top-1/2 left-[155px] size-16 -translate-x-1/2 -translate-y-1/2" size="size-11" />
      <div className="absolute top-2 right-0 bottom-2 w-[100px] overflow-hidden rounded-lg border border-rule bg-cotton shadow-stock">
        <div className="flex items-center gap-1 border-b border-rule bg-paper-2 px-1.5 py-1">
          <History className="size-2.5 text-hl-2" />
          <span className="truncate font-mono text-[8px] font-bold text-ink-2">{t("Lịch sử AI")}</span>
        </div>
        <div className="grid gap-1 p-1.5">
          {days.map(([d, rows]) => (
            <Fragment key={d}>
              <span className="font-mono text-[7px] leading-none font-bold text-ink-3 uppercase">{d}</span>
              {rows.map(([Icon, w]) => {
                const at = v({ "--fx-d": "3s", animationDelay: `${row++ * 0.18}s` }); // quick: the page opens on a short hold
                return (
                  <div key={row} className="fx-step flex items-center gap-1 border-l border-rule-2 pl-1" style={at}>
                    <Icon className="size-2.5 shrink-0 text-ink-3" />
                    <Line w={w} className="bg-ink-3/30" />
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </>;
  },
  // Đối chiếu BE: the Q&A with BE scrolls by on the left, each question / answer flies into the robot, which runs its
  // magnifier down the project's code on the right and pins a verdict on the lines it checked (adapted, off, missing, waiting)
  deep: ({ p, t }) => {
    const ask = t("Hỏi");
    const feed = [[ask, "w-20", 0], ["BE", "w-16", 1], [ask, "w-[72px]", 0], ["BE", "w-20", 1], [ask, "w-14", 0], ["BE", "w-[68px]", 1]] as const;
    const code = [[0, 44, C.hl2], [8, 52, C.info], [8, 36, C.ok], [16, 46, C.warn], [8, 30, C.info], [0, 40, C.hl2], [8, 50, C.ok], [16, 34, C.info]] as const;
    const marks = [[1, Check, C.ok], [3, TriangleAlert, C.warn], [5, X, C.err], [7, Hourglass, "var(--color-signal-2)"]] as const;
    return <>
      <div className="absolute top-1 bottom-1 left-0 w-[92px] overflow-hidden rounded-xl border border-rule bg-paper-2 px-1.5">
        <div className="fx-scroll flex flex-col gap-1.5 pt-2">
          {[...feed, ...feed].map(([who, w, be], k) => (
            <div key={k} className={cn("grid gap-1 rounded-2xl px-2 py-1.5", be ? "self-end rounded-br-sm bg-code/20" : "self-start rounded-bl-sm bg-cotton shadow-stock", w)}>
              <span className={cn("font-mono text-[8px] leading-none font-bold", be ? "text-code" : "text-info")}>{who}</span>
              <Line w="90%" /><Line w="55%" />
            </div>
          ))}
        </div>
      </div>
      <Tg className="absolute -top-1 -left-1 size-6 shadow-stock" icon="size-3" />
      {([[t("Hỏi?"), 40, C.info], ["BE: API", 96, "var(--color-code)"], ["field", 64, C.hl2], ["BE: OK", 120, "var(--color-code)"], [t("Hỏi?"), 52, C.info]] as const)
        .map(([s, y, c], k) => <Fly key={k} k={k} gap={0.6} dur={3} dot={c} path={`M88 ${y}C108 ${y} 112 80 134 80`}>{s}</Fly>)}
      {Array.from({ length: 4 }, (_, k) => <Fly key={`d${k}`} k={k} gap={0.5} dur={1.6} path={`M166 80C184 80 186 ${40 + k * 22} 206 ${40 + k * 22}`} className="size-1.5 rounded-full bg-hl" />)}
      <Bot ring className="top-1/2 left-[96px] size-[76px] -translate-y-1/2" size="size-11" />
      <div className="absolute top-1 right-0 bottom-1 w-[116px] overflow-hidden rounded-lg border border-rule bg-cotton shadow-stock">
        <div className="flex items-center gap-0.5 border-b border-rule bg-paper-2 px-1.5 py-1">
          {[C.err, C.warn, C.ok].map((c) => <span key={c} className="size-1.5 rounded-full" style={{ background: c }} />)}
          <span className="ml-1 truncate font-mono text-[8px] text-ink-3">{p || "project"}</span>
        </div>
        <div className="relative grid gap-[7px] py-1.5 pr-5 pl-1.5">
          {code.map(([x, w, c], k) => (
            <div key={k} className="flex items-center gap-1" style={{ paddingLeft: x }}>
              <span className="w-2 shrink-0 text-right font-mono text-[6px] leading-none text-ink-3/60">{k + 1}</span>
              <span className="block h-1 rounded-full opacity-60" style={{ width: w * 0.35, background: c }} />
              <span className="block h-1 rounded-full bg-ink-3/25" style={{ width: w * 0.65 }} />
            </div>
          ))}
          {marks.map(([row, Icon, c], k) => (
            <span key={row} className="fx-step absolute right-1 grid size-3.5 place-items-center rounded-full bg-cotton shadow-stock" style={v({ top: 6 + row * 11 - 1, "--fx-d": "4.8s", animationDelay: `${0.6 + k * 0.9}s` })}>
              <Icon className="size-2.5" style={{ color: c }} strokeWidth={3} />
            </span>
          ))}
        </div>
        <span className="fx-scan absolute top-4 left-0 h-6 w-full bg-linear-to-b from-transparent via-hl/25 to-transparent" style={v({ "--fx-y": "110px" })} />
      </div>
      <span className="fx-scan absolute top-3 left-[178px] grid size-7 place-items-center rounded-full border-2 border-hl bg-cotton/80 shadow-stock" style={v({ "--fx-y": "100px" })}>
        <Search className="size-3.5 text-hl-2" strokeWidth={2.5} />
      </span>
    </>;
  },
  // Trả lời từ code (Trợ lý AI): the message and its comments on the left are read and fly into the robot, which searches the
  // project, compares the code (a diff, each change marked matches / off / missing), then writes the report line by line
  code: ({ p, t }) => {
    const diff = [[" ", 44, C.hl2], ["-", 52, C.err], ["+", 48, C.ok], [" ", 36, C.info], ["-", 40, C.err], ["+", 46, C.ok]] as const;
    const marks = [[1, X, C.err], [2, Check, C.ok], [5, TriangleAlert, C.warn]] as const;
    return <>
      <div className="absolute top-1 bottom-1 left-0 w-[88px] overflow-hidden rounded-xl border border-rule bg-paper-2 p-1.5 pt-3">
        <div className="grid gap-1.5">
          <div className="grid gap-1 rounded-lg bg-cotton px-1.5 py-1.5 shadow-stock">
            <span className="font-mono text-[8px] leading-none font-bold text-hl-2">#BE</span>
            <Line w="95%" /><Line w="80%" /><Line w="60%" />
          </div>
          {[64, 50, 58].map((w, k) => (
            <div key={k} className="flex items-start gap-1">
              <span className="mt-0.5 size-2.5 shrink-0 rounded-full" style={{ background: [C.info, C.warn, C.ok][k] }} />
              <div className="grid gap-1 rounded-lg rounded-tl-sm bg-cotton px-1.5 py-1" style={{ width: w }}><Line w="90%" /><Line w="55%" /></div>
            </div>
          ))}
        </div>
        <span className="fx-scan absolute top-1 left-0 h-6 w-full bg-linear-to-b from-transparent via-info/25 to-transparent" style={v({ "--fx-y": "120px" })} />
      </div>
      <span className="absolute -top-1 -left-1 grid size-6 place-items-center rounded-full bg-info text-cotton shadow-stock"><MessageCircleQuestion className="size-3.5" /></span>
      {([[t("Hỏi?"), 30, C.info], ["@BE", 64, C.warn], ["rule", 98, C.hl2], [t("Hỏi?"), 126, C.info]] as const)
        .map(([s, y, c], k) => <Fly key={k} k={k} gap={0.7} dur={3} dot={c} path={`M80 ${y}C100 ${y} 104 88 124 88`}>{s}</Fly>)}
      <span className={cn(CHIP, "absolute top-0 left-[96px] max-w-[96px] text-hl-2")}>
        <Search className="size-2.5 shrink-0" strokeWidth={3} /><span className="truncate">{p || "grep"}</span><span className="h-2 w-px shrink-0 animate-pulse bg-hl" />
      </span>
      {Array.from({ length: 4 }, (_, k) => <Fly key={`d${k}`} k={k} gap={0.5} dur={1.6} path={`M162 82C180 82 182 ${26 + k * 14} 200 ${26 + k * 14}`} className="size-1.5 rounded-full bg-hl" />)}
      {([[Check, C.ok], [X, C.err], [Check, C.ok]] as const).map(([Icon, c], k) => (
        <Fly key={`r${k}`} k={k} gap={1} dur={3} path="M162 100C180 100 182 128 200 128" className="grid size-4 place-items-center rounded-full bg-cotton shadow-stock">
          <Icon className="size-2.5" style={{ color: c }} strokeWidth={3} />
        </Fly>
      ))}
      <Bot ring className="top-[90px] left-[90px] size-[76px] -translate-y-1/2" size="size-11" />
      <div className="absolute top-1 right-0 h-[86px] w-[120px] overflow-hidden rounded-lg border border-rule bg-cotton shadow-stock">
        <div className="flex items-center gap-0.5 border-b border-rule bg-paper-2 px-1.5 py-1">
          {[C.err, C.warn, C.ok].map((c) => <span key={c} className="size-1.5 rounded-full" style={{ background: c }} />)}
          <span className="ml-1 truncate font-mono text-[8px] text-ink-3">{p || "project"}</span>
        </div>
        <div className="relative grid gap-0.5 py-1.5 pr-5 pl-1">
          {diff.map(([s, w, c], k) => (
            <div key={k} className="flex h-2 items-center gap-1 rounded-sm px-0.5" style={{ background: s === " " ? undefined : `color-mix(in oklch, ${s === "+" ? C.ok : C.err} 15%, transparent)` }}>
              <span className="w-1.5 shrink-0 font-mono text-[7px] leading-none font-bold" style={{ color: s === "+" ? C.ok : s === "-" ? C.err : "var(--color-ink-3)" }}>{s}</span>
              <span className="block h-1 rounded-full opacity-60" style={{ width: w * 0.35, background: c }} />
              <span className="block h-1 rounded-full bg-ink-3/25" style={{ width: w * 0.6 }} />
            </div>
          ))}
          {marks.map(([row, Icon, c], k) => (
            <span key={row} className="fx-step absolute right-1 grid size-3.5 place-items-center rounded-full bg-cotton shadow-stock" style={v({ top: 3 + row * 10, "--fx-d": "4.8s", animationDelay: `${0.6 + k * 1.2}s` })}>
              <Icon className="size-2.5" style={{ color: c }} strokeWidth={3} />
            </span>
          ))}
        </div>
        <span className="fx-scan absolute top-3 left-0 h-5 w-full bg-linear-to-b from-transparent via-hl/25 to-transparent" style={v({ "--fx-y": "56px" })} />
      </div>
      <div className="absolute right-0 bottom-1 h-[60px] w-[120px] overflow-hidden rounded-lg border border-rule bg-cotton px-1.5 py-1 shadow-stock">
        <span className="flex items-center gap-1 font-mono text-[8px] font-bold text-ink-3"><FileText className="size-2.5 text-hl-2" />{t("Báo cáo")}</span>
        <div className="mt-1 grid gap-1.5">
          {["92%", "70%", "84%", "48%"].map((w, k) => (
            <span key={k} className="fx-step block h-1 rounded-full bg-hl/40" style={v({ width: w, "--fx-d": "4.8s", animationDelay: `${1 + k * 0.8}s` })} />
          ))}
        </div>
      </div>
    </>;
  },
};
