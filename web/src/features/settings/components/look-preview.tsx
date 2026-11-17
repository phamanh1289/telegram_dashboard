"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { AiThinking } from "@/shared/components/ai/chat";
import { AiFetching } from "@/shared/components/ai/fetching";
import { Button } from "@/shared/components/ui/button";
import { Segmented } from "@/shared/components/ui/segmented";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

// Cài đặt › Giao diện: a still life of the app drawn with the real tokens and components, so a colour change is seen
// on rows, chips, buttons and the loading scene as it is dragged (the look is applied live on <html>).

type View = "chat" | "ticket" | "loading";

const ROWS = [
  { who: "Linh · PO", cat: "var(--cat-3)", text: "Màn đăng nhập trên iOS bấm Quên mật khẩu không phản hồi", at: "09:12" },
  { who: "Minh · BE", cat: "var(--cat-4)", text: "API đăng nhập đã fix, nhờ {m} test lại giúp", at: "09:40", sel: true, unread: 2 },
  { who: "Hà · QC", cat: "var(--cat-6)", text: "Bản 2.4 đã lên staging, {m} xem giúp release note", at: "10:05", due: true },
] as const;

export function LookPreview({ className }: { className?: string }) {
  const t = useT();
  const [view, setView] = useState<View>("chat");
  return (
    <div className={cn("grid min-w-0 grid-cols-1 content-start gap-2", className)}>
      <span className="text-xs font-medium text-ink-3">{t("Xem trước")}</span>
      <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-rule bg-paper p-3 shadow-stock [background-image:var(--ground-wash)]">
        <Segmented id="look-preview" label={t("Xem trước")} value={view} onChange={setView}
          items={[{ value: "chat", label: t("Tin nhóm") }, { value: "ticket", label: "Ticket" }, { value: "loading", label: t("Đang tải") }]} />
        {view === "chat" && <Chat />}
        {view === "ticket" && <Ticket />}
        {view === "loading" && <div className="h-64 overflow-hidden rounded-lg bg-cotton"><AiFetching kind="chat" className="min-h-0 py-2" /></div>}
      </div>
    </div>
  );
}

function Chat() {
  const t = useT();
  const me = <span className="rounded-sm bg-hl-wash px-1 font-medium text-hl-2">@{t("bạn")}</span>;
  return <>
    <div className="rise-in grid grid-cols-1 overflow-hidden rounded-lg bg-cotton shadow-edge">
      {ROWS.map((r) => {
        const [a, b] = t(r.text).split("{m}");
        return (
          <div key={r.who} className={cn("relative grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 border-b border-rule px-3 py-2.5 last:border-0", "sel" in r && "bg-hl-wash")}>
            {"sel" in r && <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-hl" />}
            <span aria-hidden className="mt-0.5 size-7 rounded-full" style={{ background: r.cat }} />
            <span className="grid min-w-0 gap-0.5">
              <span className="flex items-center gap-1.5 text-xs">
                <span className="truncate font-medium text-ink">{r.who}</span>
                <span className="text-ink-3">{r.at}</span>
                {"unread" in r && <span className="ml-auto rounded-full bg-hl px-1.5 text-2xs font-bold text-hl-ink">{r.unread}</span>}
                {"due" in r && <span className="ml-auto rounded-full bg-signal-wash px-1.5 text-2xs font-medium text-signal-2">{t("Cần bạn")}</span>}
              </span>
              <span className="text-sm text-ink">{a}{b !== undefined && <>{me}{b}</>}</span>
            </span>
          </div>
        );
      })}
    </div>
    <div className="ai-ring flex items-center gap-2 rounded-[var(--radius-card)] border bg-cotton p-2 pl-3">
      <AiThinking lines={[t("Đang đọc tin nhóm"), t("Đang soạn trả lời")]} className="min-w-0 flex-1" />
      <Button size="sm" className="rounded-full bg-hl text-hl-ink hover:bg-hl"><Sparkles />{t("Soạn")}</Button>
    </div>
  </>;
}

function Ticket() {
  const t = useT();
  const [range, setRange] = useState<"week" | "month">("week");
  return (
    <div className="rise-in grid grid-cols-1 gap-3 rounded-lg bg-cotton p-3 shadow-edge">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-hl-2">APP-1024</span>
        <span className="rounded-full bg-hl-wash px-2 py-0.5 font-medium text-hl-2">{t("Đang làm")}</span>
        <span className="rounded-full bg-error-wash px-2 py-0.5 font-medium text-error">{t("Gấp")}</span>
      </div>
      <span className="text-md font-medium text-ink">{t("Quên mật khẩu không gửi email trên iOS")}</span>
      <span className="grid gap-1 text-xs text-ink-3">
        <span className="flex justify-between">{t("Tiến độ")}<span className="text-ink-2">65%</span></span>
        <span className="h-1.5 overflow-hidden rounded-full bg-paper-3"><span className="block h-full w-[65%] rounded-full bg-hl" /></span>
      </span>
      <Segmented id="look-preview-range" label={t("Khoảng thời gian")} value={range} onChange={setRange}
        items={[{ value: "week", label: t("Tuần") }, { value: "month", label: t("Tháng") }]} className="justify-self-start" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="bg-hl text-hl-ink hover:bg-hl">{t("Tạo ticket")}</Button>
        <Button size="sm" variant="outline" aria-pressed>{t("Đang theo dõi")}</Button>
        <Button size="sm" variant="link" className="hover:decoration-hl">{t("Mở YouTrack")}</Button>
      </div>
    </div>
  );
}
