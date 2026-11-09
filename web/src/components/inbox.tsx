"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronRight, History, House as Home, Inbox as InboxIcon, LayoutDashboard, ListChecks, type LucideIcon, Menu, MessageCircleQuestion, MessageSquare, Pin, Rocket, RotateCw, Search, Send, Sparkles, Sun, UserSearch, WifiOff, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ChatList, useChats } from "@/components/chat-list";
import { Composer, type DraftInjection } from "@/components/composer";
import { DeepThinking } from "@/components/deep-think";
import { AiDock, BriefingGroups, BriefingPage, briefingQuery, hasNews, useAutoBrief } from "@/components/briefing-page";
import { TodayPage } from "@/components/today-page";
import { DigestPage } from "@/components/digest-page";
import { QA_MINE, qaGroupsQuery, QaGroups, QaPage, type QaDays, useQaNews, useQaRecent } from "@/components/qa-page";
import { InboxPalette } from "@/components/inbox-palette";
import { MessageList } from "@/components/message-list";
import { TasksPage } from "@/components/tasks-page";
import { PendingInbox } from "@/components/pending-inbox";
import { Kbd } from "@/components/ui/kbd";
import { ShortcutsDialog } from "@/components/shortcuts";
import { Toaster, TopBar } from "@/components/shell";
import { DateRangePicker, type DayRange, rangeLabel, rangeQuery } from "@/components/date-range";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type StreamState, useSync } from "@/hooks/use-events";
import { api, type Message, type Status, statusQuery } from "@/lib/api";
import type { View } from "@/hooks/use-chat-messages";
import { ALL, BRIEFING, TODAY, goKey, msgKey, openReplyById, openTask, PINNED, QA, QaCodes, scrollToRow, TASKS, toast, typing, useTaskList } from "@/lib/inbox";
import { getPref, setPref, useRole, usesCode } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";
import { Pill } from "@/components/ui/segmented";
import { AiPlug } from "@/components/ai-plug";

const STATE_LABEL: Record<Status["state"], string> = {
  setup_required: "Chưa cấu hình Telegram: mở Cài đặt Telegram",
  login_required: "Cần đăng nhập: mở Cài đặt Telegram",
  connecting: "Đang kết nối Telegram…",
  connected: "Đã kết nối Telegram",
  degraded: "Không kết nối được Telegram (mạng chặn? bật VPN), đang thử lại",
  stopped: "Đã dừng",
};

/** Sidebar AI plug card: title per state, and the line under it when not connected (connected shows the stream state). */
const PLUG_LINE: Record<Status["state"], [string, string]> = {
  connected: ["Đã kết nối Telegram", ""],
  connecting: ["Đang kết nối Telegram…", "Chờ chút nhé"],
  degraded: ["Mất kết nối Telegram", "Mạng chặn? Bật VPN, đang thử lại"],
  setup_required: ["Chưa kết nối Telegram", "Bấm để cấu hình"],
  login_required: ["Chờ bạn đăng nhập", "Bấm để đăng nhập Telegram"],
  stopped: ["Đã ngắt kết nối Telegram", "Kết nối Telegram đã dừng"],
};

const STREAM_LABEL: Record<StreamState, string> = {
  open: "Cập nhật trực tiếp",
  connecting: "Đang nối lại luồng cập nhật…",
  closed: "Luồng cập nhật tạm dừng",
};

type NavItem = readonly [id: string, label: string, count: number, icon: LucideIcon]; // an id starting with "/" is a link to the YouTrack module

/** Sidebar section title; on the closed rail it gives way to a short rule so the sections still read apart. */
function SideHeading({ label, extra, fade, rail }: { label: string; extra?: ReactNode; fade: string; rail: boolean }) {
  return (
    <h2 className="relative mt-2 flex h-7 items-center gap-2 whitespace-nowrap px-2.5 text-xs font-medium text-ink-3">
      {rail && <span aria-hidden className="absolute inset-x-3 top-1/2 hidden h-px bg-rule-2 md:block md:group-hover/side:hidden md:group-focus-within/side:hidden" />}
      <span className={fade}>{label}</span>
      {extra && <span className={cn("ml-auto font-normal", fade)}>{extra}</span>}
    </h2>
  );
}

export function App() {
  const status = useQuery({ ...statusQuery, retry: 1 });

  if (status.isPending) {
    return (
      <main aria-busy className="grid h-dvh grid-rows-[3.5rem_1fr]">
        <span className="sr-only">Đang tải…</span>
        <div className="flex items-center gap-4 border-b px-4">
          <Skeleton className="h-8 w-44 rounded-md" />
          <Skeleton className="ml-auto h-9 w-full max-w-sm rounded-md" />
        </div>
        <div className="grid min-h-0 md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="hidden gap-3 border-r bg-paper-2 p-5 md:grid md:content-start">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4" style={{ width: `${80 - i * 12}%` }} />)}
          </div>
          <div className="grid content-start gap-5 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4">
                <Skeleton className="h-4 w-16" />
                <div className="grid gap-2"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3.5 w-full max-w-xl" /></div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }
  if (!status.data) {
    return (
      <main className="grid min-h-dvh place-items-center p-4">
        <div role="alert" className="grid max-w-sm justify-items-start gap-3">
          <h1 className="text-base">Không liên lạc được backend</h1>
          <p className="text-sm leading-relaxed text-ink-2">Server dashboard trên máy này chưa chạy hoặc vừa dừng. Mở lại app (hoặc chạy lại Start Dashboard Telegram), rồi bấm Thử lại.</p>
          <Button size="sm" variant="outline" aria-busy={status.isFetching} disabled={status.isFetching} onClick={() => void status.refetch()}>
            <RotateCw /> Thử lại
          </Button>
        </div>
      </main>
    );
  }
  return <Inbox status={status.data} />;
}

const NO_CODES: ReadonlyMap<string, string> = new Map(); // Q&A page: its cards already say the code

function Inbox({ status }: { status: Status }) {
  const stream = useSync(status.cursor);
  const taskList = useTaskList().data ?? [];
  const runningTasks = taskList.filter((t) => t.running).length;
  const codeRole = usesCode(useRole()); // QA / PO: no AI Agent unless they already have sessions
  // Selected chat lives in the query string (static export: no dynamic routes). The inbox only mounts in the browser
  // (after /status), so state starts from the URL and prefs directly, with no first paint on defaults.
  const [chatId, setChatId] = useState<string | null>(() => new URLSearchParams(location.search).get("chat") ?? TODAY); // default: Hôm nay, every source of work
  // The tag being answered; `external`: opened from elsewhere (Digest, Báo lại, ⌘K), so a send just closes it.
  // `at`: its place among the list's open tags ([n, of]), read when it opens (the reply header's "3/17").
  const [reply, setReply] = useState<{ m: Message; external: boolean; at?: [number, number] } | null>(null);
  const replyTo = reply?.m ?? null;
  // After a tag is answered or marked done, open the next open one below it (or above, at the end of the list).
  const listItems = useRef<Message[]>([]);
  // `skip`: the tag just answered / done, about to leave the list (not counted).
  const place = useCallback((m: Message, skip?: Message | null): [number, number] | undefined => {
    const open = listItems.current.filter((x) => !x.outgoing && !x.deleted && !x.handled && !(skip && msgKey(x) === msgKey(skip)));
    const i = open.findIndex((x) => msgKey(x) === msgKey(m));
    return i < 0 ? undefined : [i + 1, open.length];
  }, []);
  const pickReply = useCallback((m: Message) => {
    setReply({ m, external: false, at: place(m) });
    setDraft(null); // an injected line belongs to the tag it was made for
  }, [place]);
  const [palette, setPalette] = useState(false);
  const [dock, setDock] = useState(false); // ⌘J: the AI assistant drawer
  const [focus, setFocus] = useState<string | null>(null); // item to show in the opened view: a message, or a task on AI Agent
  const [digest, setDigest] = useState(false); // the Digest view replaces the group's tag list
  const [named, setNamed] = useState(""); // title of a group opened from Briefing: untagged ones are not in the chat list
  const [draft, setDraft] = useState<DraftInjection | null>(null);
  // "Từ lúc" filter: datetime-local text (local time) -> ISO instant for the API.
  const [days, setDays] = useState<DayRange>({ from: "", to: "" });
  const range = rangeQuery(days);
  const pendingTotal = (useChats(range).data?.items ?? []).reduce((n, c) => n + c.pending_count, 0);
  // One search box: across groups on Việc cần xử lý / Ghim, within the group when one is open.
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false); // phones: the box opens from an icon
  // First run: go straight to the Telegram setup (API ID/Hash, then login) on the settings page.
  const router = useRouter();
  const [firstRun] = useState(() => status.state === "setup_required" || status.state === "login_required");
  useEffect(() => { if (firstRun) router.replace("/settings/#telegram"); }, [firstRun, router]);
  // Sidebar: pinned open or a hover-to-open rail (remembered per browser).
  const [collapsed, setCollapsed] = useState(() => getPref("sidebarCollapsed") === "1");
  function toggleCollapsed() {
    setPref("sidebarCollapsed", collapsed ? "0" : "1");
    setCollapsed(!collapsed);
  }
  const qc = useQueryClient();
  const flashMessage = (text: string) => toast({ text });
  const [shortcuts, setShortcuts] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);
  // Global keys outside text fields: ? shortcuts, / search, g then i / p / a / b a page (z undo lives in the Toaster);
  // ⌘K / Ctrl+K the command palette, from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "j" && status.ai_configured) {
        e.preventDefault();
        setDock((o) => !o); // the AI assistant over every group, from any page
        return;
      }
      if (typing(e)) return;
      if (goKey.take()) {
        const to = { h: TODAY, i: ALL, q: QA, p: PINNED, a: TASKS, b: BRIEFING }[e.key.toLowerCase()];
        if (to && views.some(([id]) => id === to)) go(to);
        else return;
      } else if (replyTo && !reply?.external && "jk".includes(e.key.toLowerCase())) {
        advance(e.key.toLowerCase() === "j" ? 1 : -1); // the list's own j/k stand down while a reply is open
      } else if (e.key === "g") goKey.arm();
      else if (e.key === "?") setShortcuts(true);
      else if (e.key === "/") {
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      } else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // `dir` 0: after a send / done (the next one, else the last before it); 1 / -1: Alt+↓ / Alt+↑ in the reply panel.
  function advance(dir: 0 | 1 | -1 = 0) {
    if (reply?.external && !dir) {
      setReply(null);
      return;
    }
    const all = listItems.current;
    const i = all.findIndex((m) => m.chat_id === replyTo?.chat_id && m.message_id === replyTo?.message_id);
    const open = (m: Message, j: number) => j !== i && !m.outgoing && !m.deleted && !m.handled;
    const next = dir < 0 ? all.findLast((m, j) => j < i && open(m, j))
      : all.find((m, j) => j > i && open(m, j)) ?? (dir ? undefined : all.findLast((m, j) => open(m, j)));
    if (dir && !next) return toast({ text: dir > 0 ? "Không còn tag nào phía dưới" : "Không còn tag nào phía trên" });
    setReply(next ? { m: next, external: false, at: place(next, dir ? null : replyTo) } : null);
    setDraft(null);
    if (next) requestAnimationFrame(() => {
      scrollToRow(msgKey(next));
      // Focus on a list row (split view): it follows, so one row is marked, not the old one's ring and the new one's wash.
      if (document.activeElement?.matches("[data-testid=message]")) document.querySelector<HTMLElement>(`[data-key="${CSS.escape(msgKey(next))}"]`)?.focus({ preventScroll: true });
    });
  }

  // Stable (setters only): the memoised list rows keep their props.
  const useText = useCallback((m: Message, text: string) => {
    setReply({ m, external: false, at: place(m) });
    setDraft({ result: { text, options: [], analysis: "", source_message_ids: [m.message_id], context_revision: "" }, chatId: m.chat_id, nonce: Date.now() });
  }, [place]);

  // Esc: leave reply mode and clear every selection (dialogs close themselves first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog]")) return;
      setReply(null);
      setDraft(null);
      setSearch("");
      setSearchOpen(false);
      (document.activeElement as HTMLElement | null)?.blur();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function selectChat(id: string | null) {
    setChatId(id);
    setFocus(null); // one-shot: only `go` with a focus id sets it again
    setDigest(false);
    setReply(null);
    setDraft(null);
    setSearch(""); // a search belongs to the page it was typed on
    const url = new URL(location.href);
    if (id) url.searchParams.set("chat", id);
    else url.searchParams.delete("chat");
    history.replaceState(null, "", url);
  }

  const chatsData = useChats(range).data?.items ?? [];
  // Phones: the sidebar is an off-canvas sheet; desktop: pinned open or a 64px rail that opens on hover/focus.
  const [menuOpen, setMenuOpen] = useState(false);
  function toggleMenu() {
    if (matchMedia("(min-width: 48rem)").matches) toggleCollapsed();
    else setMenuOpen((v) => !v);
  }
  const [jump, setJump] = useState(0);
  const [focusView, setFocusView] = useState<View>();
  function go(id: string | null, focusId?: string, view?: View) {
    selectChat(id);
    setFocus(focusId ?? null);
    setFocusView(view);
    setJump((n) => n + 1);
    setMenuOpen(false);
  }
  // "Mở phiên" on a tagged message (lib/inbox `openTask`)
  const onOpenTask = useEffectEvent((e: Event) => go(TASKS, (e as CustomEvent<string>).detail));
  // A reply opened from Digest / Briefing / Báo lại (lib/inbox `openReply`), optionally with a first line.
  const onOpenReply = useEffectEvent((e: Event) => {
    const { m, text } = (e as CustomEvent<{ m: Message; text?: string }>).detail;
    setReply({ m, external: true });
    setDraft(text ? { result: { text, options: [], analysis: "", source_message_ids: [], context_revision: "" }, chatId: m.chat_id, nonce: Date.now() } : null);
  });
  // A "#QA…" badge on a message (lib/inbox `openQa`): that thread in its group's Q&A.
  const onOpenQa = useEffectEvent((e: Event) => {
    const { chatId: id, code } = (e as CustomEvent<{ chatId: string; code: string }>).detail;
    setQaGroup(id);
    go(QA, code);
  });
  // "Trả lời bằng Q&A" on a message (lib/inbox `answerQa`): its group's Q&A, replying to it.
  const onQaAnswer = useEffectEvent((e: Event) => {
    setReply(null);
    setQaGroup((e as CustomEvent<Message>).detail.chat_id);
    go(QA);
  });
  useEffect(() => {
    addEventListener("qa-answer", onQaAnswer);
    return () => removeEventListener("qa-answer", onQaAnswer);
  }, []);
  useEffect(() => {
    addEventListener("open-task", onOpenTask);
    addEventListener("open-reply", onOpenReply);
    addEventListener("open-qa", onOpenQa);
    return () => {
      removeEventListener("open-task", onOpenTask);
      removeEventListener("open-reply", onOpenReply);
      removeEventListener("open-qa", onOpenQa);
    };
  }, []);
  useEffect(() => { // ?chat=…&msg=… (YouTrack sheet "Nhắc trên Telegram"): that message's reply, once
    const q = new URLSearchParams(location.search), msg = q.get("msg"), chat = q.get("chat");
    if (!msg || !chat) return;
    q.delete("msg");
    history.replaceState(history.state, "", `${location.pathname}?${q}`);
    void openReplyById(chat, msg);
  }, []);
  useEffect(() => { // ?qa=<chat>&ask=<text> (YouTrack sheet "Hỏi lại trong nhóm"): that group's Q&A, the box pre-filled, once
    const q = new URLSearchParams(location.search), group = q.get("qa");
    if (!group) return;
    try { sessionStorage.setItem("qa-prefill", JSON.stringify({ chatId: group, text: q.get("ask") ?? "" })); } catch { /* private mode: no pre-fill */ }
    q.delete("qa");
    q.delete("ask");
    history.replaceState(history.state, "", `${location.pathname}${q.size ? `?${q}` : ""}`);
    setQaGroup(group);
    go(QA);
    dispatchEvent(new Event("qa-prefill")); // the group's Q&A may already be open: it takes the text now
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, from the URL the page was opened with

  const hints: Record<string, string> = {
    [TODAY]: "Mọi thứ đang chờ bạn ở cả Telegram và YouTrack, gấp nhất lên trước; và những gì bạn đang chờ người khác. (g h)",
    [ALL]: "Mọi tin tag bạn chưa xử lý, gom từ các nhóm, cũ nhất lên trước.",
    [QA]: "Đăng câu hỏi vào nhóm bất kỳ (kèm mã #QA…) và xem lại từng câu với cả chuỗi trả lời. Số: trả lời mới cộng câu của bạn chưa ai trả lời quá ngưỡng nhắc.",
    [PINNED]: "Tin bạn ghim để giữ lại, kể cả khi đã xử lý.",
    [BRIEFING]: "AI tóm tắt nhanh các nhóm: có gì mới, việc gì cần bạn.",
    [TASKS]: "Phiên AI đọc / sửa code: Giao AI Agent từ tin tag và Đối chiếu BE.",
  };
  const countSr: Record<string, string> = { [TASKS]: "đang chạy", [BRIEFING]: "nhóm có tin mới", [QA]: "trả lời mới hoặc câu cần nhắc" };
  const aiOn = status.ai_configured;
  const [qaGroup, setQaGroup] = useState<string | null>(null); // Q&A: the group picked (null: none yet)
  const qaLast = useQaRecent()[0];
  const qaShown = qaGroup ?? qaLast ?? null; // none picked: the one you asked last
  const [qaDays, setQaDays] = useState<QaDays>(7);
  // The groups you asked lately: their new replies (nav count) and which tags sit in a Q&A thread (row badges).
  const qa = useQaNews(qaDays, chatId === QA);
  const [briefGroup, setBriefGroup] = useState<string | null>(null); // Briefing: one group's items (null: all)
  const briefList = useQuery({ ...briefingQuery, enabled: aiOn }).data ?? [];
  const briefNews = briefList.filter((i) => i.consent && hasNews(i)).length;
  useAutoBrief(aiOn);
  // Sidebar sections; `views` (all pages, flat) also feeds the header title, g-keys and ⌘K.
  const sections: { label: string; items: NavItem[] }[] = [
    { label: "Việc", items: [
      [TODAY, "Hôm nay", 0, Sun],
      [ALL, "Việc cần xử lý", pendingTotal, InboxIcon],
      [QA, "Q&A", qa.total + qa.lateTotal, MessageCircleQuestion],
      [PINNED, "Tag đã ghim", 0, Pin],
    ] },
    { label: "Trợ lý AI", items: [
      ...(aiOn ? [[BRIEFING, "Briefing", briefNews, Sparkles] as NavItem] : []),
      ...(codeRole || taskList.length ? [[TASKS, "AI Agent", runningTasks, Bot] as NavItem] : []),
    ] },
    { label: "YouTrack", items: [
      ["/youtrack/", "Trang chủ YouTrack", 0, Home],
      ["/youtrack/?view=tickets", "Ticket", 0, ListChecks],
      ["/youtrack/?view=dash", "Dashboard", 0, LayoutDashboard],
      ["/youtrack/?view=release", "Release", 0, Rocket],
      ["/youtrack/?view=people", "Thành viên", 0, UserSearch],
      ...(aiOn ? [["/youtrack/?view=ai", "Lịch sử AI", 0, History] as NavItem] : []),
    ] },
  ];
  const views = sections.flatMap((s) => s.items);
  // Groups section follows the open page: Briefing's followed groups, Q&A's groups, else the tagged groups.
  const showBrief = aiOn && chatId === BRIEFING;
  const showQa = chatId === QA;
  const qaGroupTitle = useQuery({ ...qaGroupsQuery, enabled: showQa }).data?.find((g) => showQa && g.chat_id === qaShown)?.title;
  const qaTitle = showQa && qaShown === QA_MINE ? "Câu hỏi của tôi" : qaGroupTitle;
  const offline = status.state !== "connected" || stream !== "open";
  // Shown only once the problem lasts a few seconds: a reconnect blip shouldn't flash a banner.
  const [lasting, setLasting] = useState(false);
  useEffect(() => {
    if (!offline) return;
    const t = setTimeout(() => setLasting(true), 4000);
    return () => { clearTimeout(t); setLasting(false); };
  }, [offline]);
  const banner = offline && lasting;
  const filtering = !!(days.from || days.to);
  // Search and the day range filter tag lists; Briefing, Digest and AI Agent have their own (or none).
  const listPage = !!chatId && chatId !== TASKS && chatId !== BRIEFING && chatId !== QA && chatId !== TODAY && !digest;
  const inGroup = listPage && chatId !== ALL && chatId !== PINNED;
  const title = views.find(([id]) => id === chatId)?.[1] ?? (chatId === BRIEFING ? "Briefing" : chatId === QA ? "Q&A" : undefined) ?? chatsData.find((c) => c.chat_id === chatId)?.title ?? ((digest && named) || "Telegram");
  // A group already in Briefing: its Tóm tắt is Briefing for that group (one place keeps the running summary);
  // otherwise the group's Digest, where AI is allowed to read it.
  const openDigest = status.ai_configured ? () => {
    if (briefList.some((i) => i.chat_id === chatId && i.consent)) { setBriefGroup(chatId); go(BRIEFING); return; }
    setReply(null); setFocus(null); setDigest(true);
  } : undefined;
  // Rail: labels wait for the rail to open (hover or focus); phones always show them.
  const t = cn("transition-opacity duration-(--dur-micro)", collapsed && "md:opacity-0 md:group-hover/side:opacity-100 md:group-focus-within/side:opacity-100");

  return (
    <div className={cn("grid h-dvh grid-rows-[2.75rem_minmax(0,1fr)] transition-[grid-template-columns] duration-(--dur-short) ease-(--ease-out)", collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[15.5rem_minmax(0,1fr)]")}>
      <TopBar module="telegram" />
      {menuOpen && <div aria-hidden className="fixed inset-0 z-40 bg-(--scrim) md:hidden animate-in fade-in-0 duration-(--dur-short)" onClick={() => setMenuOpen(false)} />}
      {/* Sidebar, the YouTrack recipe: brand, views, groups, footer (the module switch lives in the top bar). */}
      <aside className={cn(
        "group/side fixed bottom-0 top-0 left-0 z-50 md:top-11 flex w-[15.5rem] flex-col gap-1 border-r bg-paper-2 p-3 transition-[translate,clip-path,box-shadow] duration-(--dur-short) ease-out",
        menuOpen ? "translate-x-0 shadow-pop" : "-translate-x-full",
        "md:translate-x-0 md:shadow-none",
        collapsed && "md:[clip-path:inset(0_calc(100%-4rem)_0_0)] md:hover:[clip-path:inset(0_-3rem_0_0)] md:hover:shadow-pop md:focus-within:[clip-path:inset(0_-3rem_0_0)] md:focus-within:shadow-pop",
      )}>
        <h1 className="sr-only">Radar</h1>
        <div className="flex min-h-10 items-center gap-3 px-1.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-input)] bg-hl text-hl-ink"><Send className="size-4 -translate-x-px translate-y-px" aria-hidden /></span>
          <span className={cn("grid whitespace-nowrap leading-tight", t)}>
            <span className="text-sm font-semibold">Telegram</span><span className="text-xs text-ink-3">Inbox · có AI trợ lực</span>
          </span>
        </div>
        <nav aria-label="Trang" className="grid grid-cols-1 gap-0.5">
          {/* YouTrack pages stay in `views` for ⌘K; the top bar's module switch is the way there. */}
          {sections.filter((s) => s.items.length && s.label !== "YouTrack").map((s) => (
            <section key={s.label} aria-label={s.label} className="grid gap-0.5">
              <SideHeading label={s.label} fade={t} rail={collapsed} />
              {/* "Tag đã ghim" is a tab inside Việc cần xử lý (still in ⌘K and g p), not a row here */}
              {s.items.filter(([id]) => id !== PINNED).map(([id, label, count, Icon]) => {
                const on = chatId === id || (id === ALL && chatId === PINNED);
                return (
                <Hint key={id} title={label} text={hints[id]}><button type="button" aria-current={on ? "page" : undefined} aria-label={label}
                  onClick={() => { if (id === BRIEFING) setBriefGroup(null); go(id); }}
                  className={cn(
                    "group/item relative flex min-h-9 w-full items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-left text-sm font-medium transition-[background-color,color] duration-(--dur-micro)",
                    on ? "font-semibold text-hl-2" : "text-ink-2 hover:bg-paper-3 hover:text-ink",
                  )}>
                  {on && <Pill id="tg-page" className="inset-0 rounded-[var(--radius-input)] bg-hl-wash" />}
                  <Icon className={cn("relative size-[1.125rem] shrink-0 transition-transform duration-(--dur-short) ease-(--ease-out) group-hover/item:-rotate-6 group-hover/item:scale-110 motion-reduce:transition-none", !on && "text-ink-3 group-hover/item:text-ink-2")} aria-hidden />
                  <span className={cn("relative flex-1 whitespace-nowrap", t)}>{label}</span>
                  {count > 0 && (
                    <span className={cn("relative rounded-full px-1.5 font-mono text-xs font-normal leading-5 tabular-nums", t, on ? "bg-hl text-hl-ink" : id === BRIEFING ? "bg-signal-wash text-signal-2" : "bg-paper-3 text-ink-2")}>
                      <span className="sr-only">(</span>{count}<span className="sr-only">{countSr[id] ? ` ${countSr[id]})` : ")"}</span>
                    </span>
                  )}
                  {collapsed && count > 0 && <span aria-hidden className={cn("absolute top-1.5 left-7 size-2 rounded-full ring-2 ring-paper-2 md:group-hover/side:hidden md:group-focus-within/side:hidden max-md:hidden", id === TASKS ? "bg-hl" : "bg-signal")} />}
                </button></Hint>
                );
              })}
            </section>
          ))}
        </nav>
        {filtering && (
          // The day range also filters the counts here: say so where the counts are.
          <div className={cn("mt-1 flex items-center gap-1 rounded-full bg-paper-3 py-0.5 pr-0.5 pl-2.5 text-xs text-ink-2", t)}>
            <span className="min-w-0 flex-1 truncate">Đang lọc: <b className="font-medium text-ink">{rangeLabel(days)}</b></span>
            <button type="button" aria-label="Bỏ lọc ngày" onClick={() => setDays({ from: "", to: "" })}
              className="grid size-6 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-cotton hover:text-ink">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
        <div className="-mx-3 mt-2 flex min-h-0 flex-1 flex-col border-t pt-1">
          <div className="px-3">
            <SideHeading fade={t} rail={collapsed}
              label={showBrief ? "Nhóm · Briefing" : showQa ? "Nhóm · Q&A" : "Nhóm có tag"}
              extra={!showBrief && !showQa && pendingTotal > 0 && <><span className="font-mono tabular-nums text-ink-2">{pendingTotal}</span> chưa xử lý</>} />
          </div>
          <div className={cn("min-h-0 flex-1", (showBrief || showQa) && "hidden")}>
            <ChatList selected={chatId} onSelect={go} range={range} collapsed={collapsed} bare />
          </div>
          {showQa && (
            <div className="min-h-0 flex-1">
              <QaGroups days={qaDays} collapsed={collapsed} selected={chatId === QA ? qaShown : undefined}
                onSelect={(id) => { setQaGroup(id); go(QA); }} />
            </div>
          )}
          {showBrief && (
            <div className="min-h-0 flex-1">
              <BriefingGroups collapsed={collapsed} selected={chatId === BRIEFING ? briefGroup : undefined}
                onSelect={(id) => { setBriefGroup(id); go(BRIEFING); }} onOpenDigest={(id, name) => { go(id); setNamed(name); setDigest(true); }} />
            </div>
          )}
        </div>
        <div className="-mx-3 border-t px-3 pt-2">
          <AiPlug testId="tg" icon={<Send className="size-4 -translate-x-px translate-y-px" aria-hidden />} sock="bg-info text-cotton" textClass={t}
            pose={status.state === "connected" ? "on" : status.state === "connecting" ? "try" : "off"} live={stream === "open"}
            title={PLUG_LINE[status.state][0]} sub={status.state === "connected" ? STREAM_LABEL[stream] : PLUG_LINE[status.state][1]}
            subWarn={status.state === "connected" ? stream !== "open" : status.state !== "connecting"}
            href={status.state === "setup_required" || status.state === "login_required" ? "/settings/#telegram" : undefined}
            hint={{ title: "Kết nối Telegram", text: `${STATE_LABEL[status.state]}. ${STREAM_LABEL[stream]}.` }} />
        </div>
      </aside>
      <div className="hidden md:block" aria-hidden />

      <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex min-h-14 min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 sm:px-6">
          <Hint side="bottom" text="Thu gọn / mở rộng menu">
            <Button size="icon-sm" variant="ghost" onClick={(e) => { e.currentTarget.blur(); toggleMenu(); }}
              aria-label="Thu gọn / mở rộng menu" aria-expanded={menuOpen}>
              <Menu />
            </Button>
          </Hint>
          <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-lg font-semibold tracking-[-0.01em] sm:flex-initial">
            <span className={cn("truncate", qaTitle && "shrink-0")}>{title}</span>
            {qaTitle && <><ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="min-w-0 truncate font-medium text-ink-2">{qaTitle}</span></>}
          </h2>
          {/* AI Agent puts its session tabs here (portal) instead of search and range, which it doesn't use. */}
          <div ref={setHeadSlot} className={cn("min-w-0 flex-1", chatId !== TASKS && "hidden")} />
          {listPage && <div className={cn("ml-auto flex min-w-0 flex-1 items-center justify-end gap-2", searchOpen && "max-sm:order-last max-sm:basis-full")}>
            {!searchOpen && (
              <Button size="icon-sm" variant="ghost" className="sm:hidden" aria-label="Tìm kiếm" onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); }}>
                <Search />
              </Button>
            )}
            <label className={cn("relative w-full min-w-40 max-w-80 max-sm:max-w-none sm:block", searchOpen ? "block" : "hidden")}>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => { if (!search) setSearchOpen(false); }}
                placeholder={inGroup ? "Tìm trong nhóm này…" : "Tìm ở mọi nhóm…"}
                aria-label={inGroup ? "Tìm tin tag trong nhóm này" : "Tìm tin tag ở mọi nhóm"}
                className="h-9 w-full rounded-[var(--radius-input)] border border-rule-2 bg-cotton pl-9 pr-9 text-sm text-ink transition-[border-color] duration-(--dur-micro) placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 [&::-webkit-search-cancel-button]:hidden"
              />
              {!search && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden><Kbd>/</Kbd></span>}
              {search && (
                <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setSearch("")}
                  className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </label>
            <DateRangePicker value={days} onChange={setDays} />
          </div>}
        </header>
        {/* The page sits in one card, like the YouTrack ledger. A reply opens beside the list on a wide screen (≥1280px),
            else as a detail page over it; the list stays mounted (hidden) so its scroll and "next tag" order survive. */}
        {banner && (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warn-wash px-3 py-1.5 text-xs text-warn sm:px-6">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              {status.state !== "connected" ? STATE_LABEL[status.state] : STREAM_LABEL[stream]}. Danh sách có thể chưa mới.
            </span>
            {status.state === "setup_required" || status.state === "login_required"
              ? <Link href="/settings/#telegram" className="font-semibold underline underline-offset-4">Mở Cài đặt Telegram</Link>
              : <Button size="xs" variant="outline" onClick={() => void qc.invalidateQueries()}><RotateCw /> Thử lại</Button>}
          </div>
        )}
        <div className="min-h-0 min-w-0 p-2 sm:p-4 lg:p-5">
          <QaCodes.Provider value={chatId === QA ? NO_CODES : qa.codes}>
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-card)] bg-cotton shadow-stock">
            {/* A reply is a detail page over the list (the tag shows once, full width); the list stays mounted for j / k. */}
            <div className={cn("view-back grid min-h-0 grid-cols-[minmax(0,1fr)]", replyTo && "hidden")}>
            {/* No exit wait: the next page mounts at once and rises in (globals.css .page-in); pages the AI made get the .ai-in beam. */}
            {chatId ? (
              <div key={`${chatId}:${digest}`} className={cn("page-in relative grid min-h-0 grid-cols-[minmax(0,1fr)]", (chatId === BRIEFING || chatId === TASKS || chatId === TODAY || digest) && "ai-in")}>
                {chatId === TODAY ? (
                  <TodayPage onReply={(m) => setReply({ m, external: true })} onGo={() => go(ALL)} onBriefGroup={(id) => { setBriefGroup(id); go(BRIEFING); }} />
                ) : chatId === QA ? (
                  <QaPage key={qaShown} focus={focus} group={qaShown} onGroup={setQaGroup} days={qaDays} onDays={setQaDays} onBack={() => go(ALL)} />
                ) : chatId === BRIEFING ? (
                  <BriefingPage group={briefGroup} onGroup={setBriefGroup} onBack={() => go(ALL)} onOpenDigest={(id, name) => { go(id); setNamed(name); setDigest(true); }} />
                ) : chatId === TASKS ? (
                  // keyed by focus: "Mở phiên" while already on AI Agent selects the new session
                  <TasksPage key={focus ?? ""} focus={focus} headSlot={headSlot} onOpenGroup={go} />
                ) : chatId === ALL || chatId === PINNED ? (
                  <PendingInbox pinned={chatId === PINNED} range={range} search={search} onClearSearch={() => setSearch("")} replyTo={replyTo && msgKey(replyTo)} onReply={pickReply}
                    onBack={() => setMenuOpen(true)} onUseText={useText} itemsRef={listItems} jump={jump} onPinned={(p) => go(p ? PINNED : ALL)} />
                ) : digest ? (
                  <DigestPage chatId={chatId} title={title} onBack={() => (chatsData.some((c) => c.chat_id === chatId) ? setDigest(false) : go(BRIEFING))} />
                ) : (
                <MessageList
                  onDigest={openDigest}
                  onUseText={useText}
                  chatId={chatId}
                  title={title}
                  search={search}
                  focus={focus}
                  view={focusView}
                  range={range}
                  onBack={() => go(ALL)}
                  replyTo={replyTo && msgKey(replyTo)}
                  onReply={pickReply}
                  itemsRef={listItems}
                />
                )}
              </div>
            ) : (
              <div key="empty" className="page-in grid place-items-center p-6">
                <div className="grid max-w-xs justify-items-center gap-3 text-center">
                  <MessageSquare className="size-6 text-ink-3" aria-hidden />
                  <p className="text-sm text-ink-2">Chọn một nhóm để xem tin bạn được tag</p>
                  <Button size="sm" variant="outline" onClick={() => go(ALL)}>Việc cần xử lý</Button>
                </div>
              </div>
            )}
            </div>
            {replyTo && (
              <div key={`${replyTo.chat_id}:${replyTo.message_id}`} className="detail-in grid min-h-0 grid-cols-[minmax(0,1fr)]">
                <Composer chatId={replyTo.chat_id} position={reply?.external ? undefined : reply?.at} youtrackConfigured={status.youtrack_configured ?? false} replyTo={replyTo}
              onClearReply={() => setReply(null)} onSent={() => { flashMessage("Đã gửi trả lời"); advance(); void qc.invalidateQueries({ queryKey: ["qa"] }); }} onDone={() => advance()} onStep={advance}
              onTaskCreated={(id) => { setReply(null); toast({ text: "Đã giao AI Agent", action: { label: "Mở phiên", run: () => openTask(id) },
                // Undo = stop the agent and delete the task (same as Xóa on the AI Agent page).
                undo: () => api<void>(`/tasks/${id}`, { method: "DELETE" }).finally(() => qc.invalidateQueries({ queryKey: ["tasks"] })) }); }} draft={draft}
              aiConfigured={status.ai_configured} groupTitle={chatsData.find((c) => c.chat_id === replyTo.chat_id)?.title} />
              </div>
            )}
          </div>
          </QaCodes.Provider>
        </div>
      </div>
      <DeepThinking />
      {status.ai_configured && <AiDock open={dock} onOpenChange={setDock} />}
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      <InboxPalette open={palette} onClose={() => setPalette(false)} chats={chatsData} views={views} range={range}
        group={inGroup ? chatsData.find((c) => c.chat_id === chatId) ?? null : null} onGo={go} onDigest={inGroup ? openDigest : undefined}
        onSearch={(q) => {
          if (!listPage) go(ALL);
          setSearch(q);
          setSearchOpen(true);
        }} />
      <Toaster />
    </div>
  );
}
