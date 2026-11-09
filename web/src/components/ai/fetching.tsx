"use client";

import { Check, FileText, MessageCircleQuestion, Rocket, Send, Server, Sparkles } from "lucide-react";
import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { AiBot, AiThinking } from "@/components/ai/chat";
import { YtLogo } from "@/components/yt-logo";
import { cn } from "@/lib/utils";

// Waiting on YouTrack / Telegram: one frame (shown at least AI_WAIT_MS via useAiWait, zoomed down in a narrow box, rotating lines, a running bar),
// one scene per feature that acts out what the feature does with the data. Scenes draw in a 320 × 160 box; paths are in its px.

export type FetchKind = "tickets" | "release" | "people" | "chat" | "inbox" | "history" | "qa" | "brief" | "agent" | "digest";

const LINES: Record<FetchKind, string[]> = {
  tickets: ["AI đang kết nối YouTrack", "Đang gom ticket của bạn", "Đang đọc trạng thái, người làm, sprint", "Sắp xếp lại cho gọn", "Sắp xong rồi"],
  release: ["AI đang kết nối YouTrack", "Đang gom ticket của release", "Đang đọc liên kết, bình luận", "Đang dò ticket chặn go-live", "Sắp xong rồi"],
  people: ["AI đang kết nối YouTrack", "Đang gom ticket cả team", "Đang đếm việc từng người", "Đang tìm ticket blocked, quá hạn", "Sắp xong rồi"],
  chat: ["AI đang kết nối Telegram", "Đang gom tin của nhóm", "Đang đọc tag, reply, người gửi", "Sắp xong rồi"],
  inbox: ["AI đang kết nối Telegram", "Đang gom tin tag / reply bạn", "Đang xếp theo độ gấp", "Sắp xong rồi"],
  history: ["AI đang kết nối Telegram", "Đang đọc hội thoại của nhóm", "Đang gom tin trong khoảng đã chọn", "Sắp xong rồi"],
  qa: ["AI đang kết nối Telegram", "Đang đọc các câu hỏi #QA", "Đang gom câu trả lời trong chuỗi", "Đang tìm câu chưa ai trả lời", "Sắp xong rồi"],
  brief: ["AI đang kết nối Telegram", "Đang gom tóm tắt các nhóm", "Đang tìm việc chờ bạn", "Đang xếp theo độ gấp", "Sắp xong rồi"],
  digest: ["AI đang đọc hội thoại của nhóm", "Đang ghép câu hỏi với câu trả lời", "Đang gom theo chủ đề, đánh dấu trao đổi với BE", "Đang tìm việc cần confirm, điều đã chốt", "Sắp xong rồi"],
  agent: ["Đang đọc tin cần xử lý", "Đang mở ticket, link trong tin", "Đang ghép phân tích và yêu cầu thêm", "Đang mở dự án", "Đang khởi động phiên AI Agent"],
};

/** The digest scene's lines, naming the group being read. */
export const digestLines = (group?: string) => [group ? `AI đang đọc hội thoại ${group}` : LINES.digest[0], ...LINES.digest.slice(1)];

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

/**
 * Waiting on the data a feature reads; `project` names YouTrack ticket IDs (for `agent`: the project folder), `lines` replaces the feature's own.
 * `cover`: laid over the (relative) list box, so the rows render and scroll into place underneath during the hold.
 */
export function AiFetching({ kind, project = "", lines, cover, className }: { kind: FetchKind; project?: string; lines?: string[]; cover?: boolean; className?: string }) {
  const Scene = SCENES[kind];
  return (
    <div className={cn("@container grid w-full place-items-center", cover ? "absolute inset-0 z-10 bg-cotton" : "min-h-[50vh] py-6", className)}>
      <div className="grid justify-items-center gap-5 animate-in fade-in-0 zoom-in-95 duration-(--dur-short) @max-[21rem]:[zoom:0.8]">
        <div aria-hidden className="relative h-40 w-80"><Scene p={project} /></div>
        <AiThinking lines={lines ?? LINES[kind]} className="w-72 max-w-full justify-center [&>svg]:hidden" />
        <span className="ai-bar h-1 w-56 max-w-full rounded-full" />
      </div>
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
      <span className="max-w-20 truncate font-mono text-[10px] font-semibold tracking-wide text-ink-3">{label}</span>
    </div>
  );
}

/** Telegram's mark, as on the Telegram switch and the sidebar plug. */
const Tg = ({ className = "size-9", icon = "size-5" }: { className?: string; icon?: string }) => (
  <span className={cn("grid place-items-center rounded-full bg-info text-cotton", className)}><Send className={cn("-translate-x-px translate-y-px", icon)} /></span>
);
const Line = ({ w, className }: { w: string | number; className?: string }) => <span className={cn("block h-1 rounded-full bg-ink-3/25", className)} style={{ width: w }} />;
/** A soft cone pointing at the robot (wide at the data, narrow at the robot). */
const Cone = ({ className }: { className: string }) => (
  <span className={cn("absolute animate-pulse bg-linear-to-r from-hl/5 to-hl/25 [clip-path:polygon(0_0,100%_42%,100%_58%,0_100%)]", className)} />
);
const Bubble = ({ me, w, tag }: { me?: boolean; w: string; tag?: boolean }) => (
  <div className={cn("mb-1.5 grid gap-1 rounded-2xl px-2 py-1.5", me ? "self-end rounded-br-sm bg-hl/25" : "self-start rounded-bl-sm bg-cotton shadow-stock", w)}>
    {tag && <span className="font-mono text-[9px] leading-none font-semibold text-info">@bạn</span>}
    <Line w="90%" /><Line w="60%" />
  </div>
);

// ---- scenes

type Scene = (a: { p: string }) => ReactNode;
const tid = (p: string, n: number) => `${p || "YT"}-${n}`; // a ticket ID of the current project
const ARCS = ["M44 70C110 -6 200 0 268 80", "M44 70C110 150 200 160 268 80"];

const SCENES: Record<FetchKind, Scene> = {
  // the ticket list: the robot pulls ticket IDs and fields out of YouTrack
  tickets: ({ p }) => <>
    <Cone className="inset-y-7 right-12 left-12" />
    {([[tid(p, 128), C.hl], ["State", C.info], [tid(p, 342), C.hl], ["Sprint", C.ok], ["Priority", C.err], [tid(p, 517), C.hl], ["Assignee", C.warn], ["Type", C.hl2]] as const)
      .map(([t, c], k) => <Fly key={k} k={k} dot={c} path={ARCS[k % 2]}>{t}</Fly>)}
    <Tile label={p || "YouTrack"} className="top-1/2 left-1 -translate-y-1/2"><YtLogo className="size-9" /></Tile>
    <Bot ring className="top-1/2 right-0 size-24 -translate-y-1/2" />
  </>,

  // release: tickets ride a belt through the robot's check; ready ones lift into the go-live rocket, blocked ones drop into "Chặn"
  release: ({ p }) => <>
    <span className="absolute top-[92px] right-16 left-8 border-t border-dashed border-rule-2" />
    <span className="absolute top-[40px] left-[149px] h-[50px] w-0.5 animate-pulse rounded-full bg-linear-to-b from-hl to-hl/0" />
    {([[`${tid(p, 128)} Done`, true], ["Blocked", false], [`${tid(p, 517)} Fixed`, true], ["Quá hạn", false], [`${tid(p, 206)} QC`, true], [`${tid(p, 731)} Done`, true]] as const)
      .map(([t, ok], k) => <Fly key={k} k={k} gap={0.55} dur={3.3} dot={ok ? C.ok : C.err} path={ok ? "M30 92H150C205 92 228 46 284 34" : "M30 92H150C205 92 236 134 278 142"}>{t}</Fly>)}
    <span className="absolute top-[72px] left-0 grid size-10 place-items-center rounded-lg border border-rule bg-cotton shadow-stock"><YtLogo className="size-6" /></span>
    <Bot className="top-0 left-[128px] size-11" size="size-9" />
    <div className="absolute top-0 right-0 grid justify-items-center gap-0.5">
      <span className="grid size-14 place-items-center rounded-full bg-hl-wash"><Rocket className="ai-float size-7 text-hl-2" /></span>
      <span className="font-mono text-[10px] font-semibold text-ink-3">Go-live</span>
    </div>
    <span className="absolute right-1 bottom-1 rounded-md bg-error-wash px-1.5 py-0.5 text-[10px] font-medium text-error">Chặn go-live</span>
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
          <span className="absolute bottom-1 grid size-7 -translate-x-1/2 place-items-center rounded-full bg-paper-3 text-[11px] font-semibold text-ink-2 shadow-stock" style={{ left: x }}>{n}</span>
        </Fragment>
      ))}
      <Bot className="top-0 left-1/2 size-14 -translate-x-1/2" size="size-10" />
    </>;
  },

  // a group's messages: the chat scrolls by, a scan line reads it, the robot takes it in
  chat: () => {
    const feed = [[false, "w-28"], [true, "w-20"], [false, "w-24", true], [false, "w-16"], [true, "w-28"], [false, "w-20"]] as const;
    return <>
      <div className="absolute top-1 bottom-1 left-4 w-44 overflow-hidden rounded-xl border border-rule bg-paper-2 px-2">
        <div className="fx-scroll flex flex-col pt-2">{[...feed, ...feed].map(([me, w, tag], k) => <Bubble key={k} me={me} w={w} tag={!!tag} />)}</div>
      </div>
      <span className="fx-scan absolute top-1 left-4 h-8 w-44 bg-linear-to-b from-transparent via-hl/25 to-transparent" style={v({ "--fx-y": "120px" })} />
      <Tg className="absolute -top-1 left-1 size-7 shadow-stock" icon="size-3.5" />
      <Cone className="top-9 bottom-9 left-[196px] right-14" />
      <Bot ring className="top-1/2 right-0 size-20 -translate-y-1/2" size="size-12" />
    </>;
  },

  // tags waiting on you: each passes through the robot and drops into its urgency lane
  inbox: () => {
    const lanes = [["Quá hạn", C.err, 34], ["Hôm nay", C.warn, 80], ["Để sau", C.info, 126]] as const;
    return <>
      {([["@bạn", 0], ["Reply", 1], ["Tag", 2], ["@bạn 3h", 0], ["Hỏi", 1], ["FYI", 2]] as const).map(([t, l], k) => {
        const [, c, y] = lanes[l];
        return <Fly key={k} k={k} gap={0.5} dur={3} dot={c} path={`M44 72C90 72 112 80 150 80C196 80 214 ${y} 262 ${y}`}>{t}</Fly>;
      })}
      <Tile label="Telegram" className="top-1/2 left-1 -translate-y-1/2"><Tg /></Tile>
      <Bot className="top-1/2 left-[118px] size-16 -translate-y-1/2" size="size-11" />
      {lanes.map(([l, c, y]) => (
        <span key={l} className="absolute right-0 flex h-7 w-[68px] -translate-y-1/2 items-center gap-1 rounded-md border border-rule bg-cotton px-1.5 text-[10px] font-medium text-ink-2 shadow-stock" style={{ top: y }}>
          <span className="size-1.5 rounded-full" style={{ background: c }} />{l}
        </span>
      ))}
    </>;
  },

  // the digest's conversation: messages pop up day by day along a timeline, the picked range sweeps over them
  history: () => {
    const pops = [[8, 74], [30, 46], [50, 82], [72, 58], [94, 34], [112, 76], [134, 50], [154, 84], [172, 40], [186, 66]];
    return <>
      <span className="absolute top-[108px] left-2 w-[204px] border-t border-rule-2" />
      {["T2", "T3", "T4", "T5", "T6"].map((d, k) => <span key={d} className="absolute top-[114px] -translate-x-1/2 font-mono text-[9px] text-ink-3" style={{ left: 22 + k * 44 }}>{d}</span>)}
      {pops.map(([x, y], k) => (
        <span key={k} className={cn("fx-step absolute h-3.5 w-9 rounded-xl", k % 3 === 1 ? "rounded-br-sm bg-hl/40" : "rounded-bl-sm border border-rule-2 bg-cotton shadow-stock")}
          style={v({ left: x, top: y, "--fx-d": "4s", animationDelay: `${k * 0.3}s` })} />
      ))}
      <span className="fx-sweep absolute top-6 left-1 h-[100px] w-14 rounded-lg border border-hl/50 bg-hl/10" style={v({ "--fx-x": "150px" })} />
      <Tg className="absolute top-[132px] left-1 size-5" icon="size-3" />
      <span className="absolute top-[134px] left-7 font-mono text-[9px] text-ink-3">khoảng đã chọn</span>
      <span className="absolute top-[80px] left-[214px] w-8 border-t border-dashed border-hl/40" />
      <Bot ring className="top-1/2 right-0 size-20 -translate-y-1/2" size="size-12" />
    </>;
  },

  // Q&A: a #QA question pings, answers join its thread one by one, the accepted one gets "Chốt"
  qa: () => <>
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
      <Check className="size-3" />Chốt
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
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-paper-3 text-[9px] font-semibold text-ink-2">{n}</span>
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
  digest: () => {
    const feed = [["PO", "w-20", 0], ["BE", "w-16", 1], ["QA", "w-[72px]", 0], ["BE", "w-20", 1], ["Dev", "w-14", 0], ["PO", "w-[68px]", 0]] as const;
    const lanes = [["Cần confirm", C.warn, 30, MessageCircleQuestion], ["Đã chốt", C.ok, 80, Check], ["Với BE", "var(--color-code)", 130, Server]] as const;
    return <>
      <div className="absolute top-1 bottom-1 left-0 w-[104px] overflow-hidden rounded-xl border border-rule bg-paper-2 px-1.5">
        <div className="fx-scroll flex flex-col gap-1.5 pt-2">
          {[...feed, ...feed].map(([who, w, be], k) => (
            <div key={k} className={cn("grid gap-1 rounded-2xl px-2 py-1.5", be ? "self-end rounded-br-sm bg-code/20" : "self-start rounded-bl-sm bg-cotton shadow-stock", w)}>
              <span className={cn("font-mono text-[8px] leading-none font-semibold", be ? "text-code" : "text-ink-3")}>{who}</span>
              <Line w="90%" /><Line w="55%" />
            </div>
          ))}
        </div>
      </div>
      <span className="fx-scan absolute top-1 left-0 h-8 w-[104px] bg-linear-to-b from-transparent via-hl/25 to-transparent" style={v({ "--fx-y": "120px" })} />
      <Tg className="absolute -top-1 -left-1 size-6 shadow-stock" icon="size-3" />
      {([["Hỏi?", 0, 40], ["BE: API", 2, 96], ["Chốt", 1, 64], ["QA hỏi", 0, 120], ["Đổi field", 2, 52], ["OK", 1, 108]] as const).map(([t, l, sy], k) => {
        const [, c, y] = lanes[l];
        return <Fly key={k} k={k} gap={0.55} dur={3.2} dot={c} path={`M100 ${sy}C122 ${sy} 128 80 154 80C192 80 204 ${y} 232 ${y}`}>{t}</Fly>;
      })}
      <Bot ring className="top-1/2 left-[112px] size-[72px] -translate-y-1/2" size="size-11" />
      {lanes.map(([l, c, y, Icon], n) => (
        <div key={l} className="absolute right-0 grid w-[84px] -translate-y-1/2 gap-1 rounded-md border border-rule bg-cotton px-1.5 py-1 shadow-stock" style={{ top: y }}>
          <span className="flex items-center gap-1 text-[9px] font-semibold text-ink-2"><Icon className="size-2.5 shrink-0" style={{ color: c }} />{l}</span>
          <span className="flex gap-0.5">
            {[0, 1, 2].map((k) => <span key={k} className="fx-step block h-1 flex-1 rounded-full" style={v({ background: c, "--fx-d": "4.5s", animationDelay: `${0.6 + n * 0.3 + k * 0.9}s` })} />)}
          </span>
        </div>
      ))}
    </>;
  },

  // handing a message to the agent: the message, its tickets and links fly into the robot, which loads them line by line into the session
  agent: ({ p }) => {
    const srcs = [[22, "Tin", <Tg key="t" className="size-6" icon="size-3" />], [80, "Ticket", <YtLogo key="y" className="size-6" />], [138, "Link", <FileText key="f" className="size-5 text-hl-2" />]] as const;
    return <>
      {([["Tin nhắn", 0, C.info], ["YT-128", 1, C.hl], ["link", 2, C.warn], ["Phân tích", 0, C.hl2], ["spec.md", 2, C.ok], ["YT-342", 1, C.hl]] as const)
        .map(([t, s, c], k) => { const y = srcs[s][0]; return <Fly key={k} k={k} gap={0.5} dur={2.8} dot={c} path={`M56 ${y}C100 ${y} 110 80 138 80`}>{t}</Fly>; })}
      {Array.from({ length: 4 }, (_, k) => <Fly key={k} k={k} gap={0.6} dur={1.6} path="M182 80H236" className="size-1.5 rounded-full bg-hl" />)}
      {srcs.map(([y, l, icon]) => (
        <div key={l} className="absolute left-0 flex h-9 w-14 -translate-y-1/2 items-center gap-1 rounded-lg border border-rule bg-cotton px-1 shadow-stock" style={{ top: y }}>
          {icon}<span className="font-mono text-[9px] font-semibold text-ink-3">{l}</span>
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
};
